import { describe, expect, it } from "vitest";
import { RiskManagerService } from "../src/services/RiskManagerService.js";

describe("RiskManagerService", () => {
  const service = new RiskManagerService();

  it("blocks trading when kill switch is enabled", () => {
    const result = service.evaluate({
      symbol: "005930",
      side: "BUY",
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
      killSwitchEnabled: true
    });

    expect(result.allow).toBe(false);
    expect(result.ruleHits).toContain("KILL_SWITCH_ACTIVE");
  });

  it("calculates maxQty under 0.5% risk-per-trade rule", () => {
    const result = service.evaluate({
      symbol: "005930",
      side: "BUY",
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
      killSwitchEnabled: false
    });

    expect(result.maxQty).toBe(200);
    expect(result.allow).toBe(true);
  });
});
