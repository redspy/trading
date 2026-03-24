// ─────────────────────────────────────────────────────────────
// 추세추종 전략 서비스 (Phase 1 기본 전략)
//
// 진입 조건 (매수 신호):
//   - 현재가 > 직전 20일 최고가  (20일 돌파)
//   - 현재가 > 60일 이동평균     (추세 필터)
//   - 해당 심볼에 보유 포지션 없음
//
// 청산 조건 (매도 신호):
//   - 현재가 ≤ 평균 매입가 × (1 - 고정손절비율)
//
// 가격 이력은 인메모리(Map)로 관리한다.
// 서버 재시작 시 초기화되며, 최소 60틱 이상 수신 후 신호가 발생한다.
// ─────────────────────────────────────────────────────────────

import type { MarketEvent, Position, TradeSignal } from "@trading/shared-domain";

export interface StrategyDecisionContext {
  position?: Position;
  fixedStopLossPct: number; // 고정 손절 비율 (예: 0.025 = 2.5%)
}

export class TrendStrategyService {
  // 심볼별 가격 이력 (최대 120틱 유지)
  private readonly history = new Map<string, number[]>();

  public onMarketEvent(event: MarketEvent, context: StrategyDecisionContext): TradeSignal | null {
    // 가격 이력 업데이트 (최대 120개 유지)
    const prices = this.history.get(event.symbol) ?? [];
    prices.push(event.price);
    if (prices.length > 120) {
      prices.shift();
    }
    this.history.set(event.symbol, prices);

    // 포지션 보유 중이면 손절 체크 우선 수행
    if (context.position && context.position.qty > 0) {
      const stopPrice = context.position.avgPrice * (1 - context.fixedStopLossPct);
      if (event.price <= stopPrice) {
        return {
          symbol: event.symbol,
          side: "SELL",
          reason: `Fixed stop-loss breach (${context.fixedStopLossPct * 100}%)`,
          confidence: 1,
          ts: event.ts
        };
      }
    }

    // 60틱 미만이면 SMA 계산 불가 — 신호 없음
    if (prices.length < 60) {
      return null;
    }

    const latest = prices[prices.length - 1];
    // 직전 20틱(현재 제외)의 최고가
    const prior20 = prices.slice(-21, -1);
    const max20 = Math.max(...prior20);
    // 60일 단순 이동평균
    const sma60 = prices.slice(-60).reduce((acc, cur) => acc + cur, 0) / 60;

    // 20일 돌파 + 60일 추세 필터 + 포지션 없음 → 매수 신호
    if (
      latest !== undefined &&
      latest > max20 &&
      latest > sma60 &&
      (!context.position || context.position.qty === 0)
    ) {
      return {
        symbol: event.symbol,
        side: "BUY",
        reason: "20-day breakout with 60-day trend filter",
        confidence: 0.75,
        ts: event.ts
      };
    }

    return null;
  }
}
