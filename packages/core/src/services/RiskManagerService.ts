import type { RiskDecision } from "@trading/shared-domain";

export interface RiskManagerInput {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  accountEquity: number;
  riskPerTradePct: number;
  fixedStopLossPct: number;
  dailyLossLimitPct: number;
  currentDailyLossPct: number;
  maxPositions: number;
  currentPositions: number;
  hasPosition: boolean;
  hasDuplicateActiveOrder: boolean;
  killSwitchEnabled: boolean;
}

export class RiskManagerService {
  public evaluate(input: RiskManagerInput): RiskDecision {
    const ruleHits: string[] = [];

    if (input.killSwitchEnabled) {
      ruleHits.push("KILL_SWITCH_ACTIVE");
    }
    if (input.currentDailyLossPct <= -Math.abs(input.dailyLossLimitPct)) {
      ruleHits.push("DAILY_LOSS_LIMIT_REACHED");
    }
    if (input.hasDuplicateActiveOrder) {
      ruleHits.push("DUPLICATE_ACTIVE_ORDER");
    }
    if (input.side === "BUY" && !input.hasPosition && input.currentPositions >= input.maxPositions) {
      ruleHits.push("MAX_POSITIONS_REACHED");
    }

    const riskBudget = input.accountEquity * input.riskPerTradePct;
    const perShareRisk = Math.max(input.price * input.fixedStopLossPct, 1);
    const maxQty = Math.max(0, Math.floor(riskBudget / perShareRisk));

    if (maxQty <= 0) {
      ruleHits.push("POSITION_SIZE_ZERO");
    }

    return {
      allow: ruleHits.length === 0,
      ruleHits,
      maxQty
    };
  }
}
