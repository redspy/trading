import type { MarketEvent, OrderIntent } from "@trading/shared-domain";
import { AppError, ErrorCode } from "../errors/AppError.js";
import type { EventRepo, OrderRepo, PositionRepo } from "../repo/interfaces.js";
import type { AppEnv } from "../config/env.js";
import { ExecutionService } from "./ExecutionService.js";
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
    private readonly runtimeFlags: RuntimeFlags
  ) {}

  public async onMarketEvent(event: MarketEvent): Promise<void> {
    this.eventRepo.insertMarketEvent(event);
    this.positionRepo.updateMarkPrice(event.symbol, event.price);

    const positions = this.positionRepo.list();
    const position = positions.find((item) => item.symbol === event.symbol);
    const signal = this.strategyService.onMarketEvent(event, {
      ...(position ? { position } : {}),
      fixedStopLossPct: this.env.FIXED_STOP_LOSS_PCT
    });

    if (!signal) {
      return;
    }

    this.eventRepo.insertSignal(signal);

    const dailyPnl = this.positionRepo.getDailyPnl(event.ts.slice(0, 10));
    const currentDailyLossPct =
      this.env.ACCOUNT_EQUITY === 0 ? 0 : dailyPnl.totalPnl / this.env.ACCOUNT_EQUITY;

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
      killSwitchEnabled: this.runtimeFlags.isKillSwitchEnabled()
    });

    this.eventRepo.insertRiskDecision(signal.symbol, decision, signal.ts);

    if (!decision.allow) {
      throw new AppError(ErrorCode.RISK_BLOCKED, "Risk manager blocked order", {
        symbol: signal.symbol,
        ruleHits: decision.ruleHits
      });
    }

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
