import { describe, expect, it } from "vitest";
import { RiskManagerService } from "../src/services/RiskManagerService.js";

describe("RiskManagerService", () => {
  const service = new RiskManagerService();

  const baseInput = {
    symbol: "005930",
    side: "BUY" as const,
    price: 100000,
    accountEquity: 100_000_000,
    riskPerTradePct: 0.005,
    fixedStopLossPct: 0.025,
    dailyLossLimitPct: 0.02,
    currentDailyLossPct: 0,
    maxPositions: 5,
    currentPositions: 0,
    hasPosition: false,
    hasDuplicateActiveOrder: false,
    killSwitchEnabled: false,
    marketOpen: true
  };

  it("blocks trading when kill switch is enabled", () => {
    const result = service.evaluate({ ...baseInput, killSwitchEnabled: true });
    expect(result.allow).toBe(false);
    expect(result.ruleHits).toContain("KILL_SWITCH_ACTIVE");
  });

  it("calculates maxQty under 0.5% risk-per-trade rule", () => {
    const result = service.evaluate(baseInput);
    expect(result.maxQty).toBe(200);
    expect(result.allow).toBe(true);
  });

  it("blocks BUY when market is closed", () => {
    const result = service.evaluate({ ...baseInput, marketOpen: false });
    expect(result.allow).toBe(false);
    expect(result.ruleHits).toContain("MARKET_CLOSED");
  });

  it("allows SELL when market is closed (stop-loss exit)", () => {
    const result = service.evaluate({ ...baseInput, side: "SELL", marketOpen: false, hasPosition: true });
    expect(result.ruleHits).not.toContain("MARKET_CLOSED");
  });

  it("blocks when daily loss limit is reached", () => {
    const result = service.evaluate({ ...baseInput, currentDailyLossPct: -0.025 });
    expect(result.allow).toBe(false);
    expect(result.ruleHits).toContain("DAILY_LOSS_LIMIT_REACHED");
  });
});
