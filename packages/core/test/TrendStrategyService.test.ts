import { describe, expect, it } from "vitest";
import { TrendStrategyService } from "../src/services/TrendStrategyService.js";

describe("TrendStrategyService", () => {
  it("generates BUY signal on breakout over 20-high with 60 trend filter", () => {
    const service = new TrendStrategyService();
    const symbol = "005930";

    for (let i = 0; i < 59; i += 1) {
      service.onMarketEvent(
        {
          symbol,
          ts: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
          price: 100 + i,
          volume: 1000,
          source: "WS"
        },
        { fixedStopLossPct: 0.025 }
      );
    }

    const signal = service.onMarketEvent(
      {
        symbol,
        ts: new Date(Date.UTC(2026, 0, 1, 1, 0)).toISOString(),
        price: 300,
        volume: 1000,
        source: "WS"
      },
      { fixedStopLossPct: 0.025 }
    );

    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("BUY");
  });

  it("generates SELL signal when fixed stop loss is breached", () => {
    const service = new TrendStrategyService();
    const signal = service.onMarketEvent(
      {
        symbol: "069500",
        ts: new Date(Date.UTC(2026, 0, 1, 9, 0)).toISOString(),
        price: 95,
        volume: 200,
        source: "WS"
      },
      {
        fixedStopLossPct: 0.025,
        position: {
          symbol: "069500",
          qty: 10,
          avgPrice: 100,
          unrealizedPnl: 0,
          realizedPnl: 0
        }
      }
    );

    expect(signal?.side).toBe("SELL");
  });
});
