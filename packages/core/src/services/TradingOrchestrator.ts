// ─────────────────────────────────────────────────────────────
// 트레이딩 오케스트레이터
//
// 시세 이벤트가 도착하면 아래 흐름을 조율한다:
//
//   1. 시세 이벤트 → DB 기록 + 포지션 mark-to-market 업데이트
//   2. TrendStrategyService.onMarketEvent() → TradeSignal 생성
//   3. 당일 손익률 계산
//   4. RiskManagerService.evaluate() → 리스크 규칙 검사
//   5. 차단 → RISK_BLOCKED 에러 (createApp에서 blocked 카운트 처리)
//   6. 허용 → OrderIntent 생성 → ExecutionService.placeOrder()
//
// 이 클래스는 비즈니스 흐름의 "접착제"만 담당하며
// 각 서비스의 내부 로직에는 관여하지 않는다.
// ─────────────────────────────────────────────────────────────

import type { MarketEvent, OrderIntent } from "@trading/shared-domain";
import { AppError, ErrorCode } from "../errors/AppError.js";
import type { EventRepo, OrderRepo, PositionRepo } from "../repo/interfaces.js";
import type { AppEnv } from "../config/env.js";
import { ExecutionService } from "./ExecutionService.js";
import { KoreanMarketSession } from "./KoreanMarketSession.js";
import { RiskManagerService } from "./RiskManagerService.js";
import { TrendStrategyService } from "./TrendStrategyService.js";
import type { RuntimeFlags } from "./RuntimeFlags.js";

export class TradingOrchestrator {
  public constructor(
    private readonly env: AppEnv,
    private readonly eventRepo: EventRepo,
    private readonly orderRepo: OrderRepo,
    private readonly positionRepo: PositionRepo,
    private readonly strategyService: TrendStrategyService,
    private readonly riskManager: RiskManagerService,
    private readonly executionService: ExecutionService,
    private readonly runtimeFlags: RuntimeFlags,
    private readonly marketSession: KoreanMarketSession
  ) {}

  public async onMarketEvent(event: MarketEvent): Promise<void> {
    // 시세 이벤트 기록 + 포지션 현재가 업데이트
    this.eventRepo.insertMarketEvent(event);
    this.positionRepo.updateMarkPrice(event.symbol, event.price);

    // 현재 포지션 조회 후 전략 신호 생성
    const positions = this.positionRepo.list();
    const position = positions.find((item) => item.symbol === event.symbol);
    const signal = this.strategyService.onMarketEvent(event, {
      ...(position ? { position } : {}),
      fixedStopLossPct: this.env.FIXED_STOP_LOSS_PCT
    });

    // 신호 없으면 종료
    if (!signal) {
      return;
    }

    this.eventRepo.insertSignal(signal);

    // 당일 손익률 계산 (손실 한도 판단용)
    const dailyPnl = this.positionRepo.getDailyPnl(event.ts.slice(0, 10));
    const currentDailyLossPct =
      this.env.ACCOUNT_EQUITY === 0 ? 0 : dailyPnl.totalPnl / this.env.ACCOUNT_EQUITY;

    // 리스크 검사
    const decision = this.riskManager.evaluate({
      symbol: signal.symbol,
      side: signal.side,
      price: event.price,
      accountEquity: this.env.ACCOUNT_EQUITY,
      riskPerTradePct: this.env.RISK_PER_TRADE_PCT,
      fixedStopLossPct: this.env.FIXED_STOP_LOSS_PCT,
      dailyLossLimitPct: this.env.DAILY_LOSS_LIMIT_PCT,
      currentDailyLossPct,
      maxPositions: this.env.MAX_POSITIONS,
      currentPositions: positions.filter((item) => item.qty > 0).length,
      hasPosition: Boolean(position && position.qty > 0),
      hasDuplicateActiveOrder: this.orderRepo.hasActiveOrder(signal.symbol, signal.side),
      killSwitchEnabled: this.runtimeFlags.isKillSwitchEnabled(),
      marketOpen: this.marketSession.isOpen()
    });

    this.eventRepo.insertRiskDecision(signal.symbol, decision, signal.ts);

    // 리스크 규칙 위반 시 예외 발생 → createApp에서 blocked 카운트로 처리
    if (!decision.allow) {
      throw new AppError(ErrorCode.RISK_BLOCKED, "Risk manager blocked order", {
        symbol: signal.symbol,
        ruleHits: decision.ruleHits
      });
    }

    // clientOrderId: 심볼-타임스탬프-방향 조합 (콜론/점 → 대시로 정규화)
    const orderIntent: OrderIntent = {
      symbol: signal.symbol,
      side: signal.side,
      qty: decision.maxQty,
      type: "MARKET",
      tif: "DAY",
      clientOrderId: `${signal.symbol}-${signal.ts}-${signal.side}`.replace(/[:.]/g, "-")
    };

    await this.executionService.placeOrder(orderIntent);
  }
}
