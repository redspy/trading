import type { MarketEvent, Position, TradeSignal } from "@trading/shared-domain";

export interface StrategyDecisionContext {
  position?: Position;
  fixedStopLossPct: number;
}

export class TrendStrategyService {
  private readonly history = new Map<string, number[]>();

  public onMarketEvent(event: MarketEvent, context: StrategyDecisionContext): TradeSignal | null {
    const prices = this.history.get(event.symbol) ?? [];
    prices.push(event.price);
    if (prices.length > 120) {
      prices.shift();
    }
    this.history.set(event.symbol, prices);

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

    if (prices.length < 60) {
      return null;
    }

    const latest = prices[prices.length - 1];
    const prior20 = prices.slice(-21, -1);
    const max20 = Math.max(...prior20);
    const sma60 = prices.slice(-60).reduce((acc, cur) => acc + cur, 0) / 60;

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
