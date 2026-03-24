// ─────────────────────────────────────────────────────────────
// 리스크 매니저 서비스
//
// 매매 신호가 발생했을 때 아래 규칙을 순서대로 검사한다.
// 하나라도 위반되면 allow=false를 반환하고 ruleHits에 기록된다.
//
// 검사 규칙:
//   KILL_SWITCH_ACTIVE        — 킬스위치 활성화 중
//   MARKET_CLOSED             — 장외 시간 매수 시도 (매도는 허용)
//   DAILY_LOSS_LIMIT_REACHED  — 당일 손실이 한도(-2%) 초과
//   DUPLICATE_ACTIVE_ORDER    — 동일 심볼/방향의 미체결 주문 존재
//   MAX_POSITIONS_REACHED     — 최대 보유 종목 수 초과
//   POSITION_SIZE_ZERO        — 리스크 예산으로 계산한 수량이 0
//
// 포지션 크기 계산:
//   riskBudget = accountEquity × riskPerTradePct
//   perShareRisk = price × fixedStopLossPct
//   maxQty = floor(riskBudget / perShareRisk)
// ─────────────────────────────────────────────────────────────

import type { RiskDecision } from "@trading/shared-domain";

export interface RiskManagerInput {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  accountEquity: number;        // 총 자산 (원)
  riskPerTradePct: number;      // 1회 손실 한도 비율 (예: 0.005 = 0.5%)
  fixedStopLossPct: number;     // 고정 손절 비율 (예: 0.025 = 2.5%)
  dailyLossLimitPct: number;    // 일일 손실 한도 비율 (예: 0.02 = 2%)
  currentDailyLossPct: number;  // 당일 현재 손익률 (음수 = 손실)
  maxPositions: number;         // 최대 보유 종목 수
  currentPositions: number;     // 현재 보유 종목 수
  hasPosition: boolean;         // 해당 심볼 포지션 보유 여부
  hasDuplicateActiveOrder: boolean; // 동일 심볼/방향 미체결 주문 여부
  killSwitchEnabled: boolean;   // 킬스위치 활성화 여부
  marketOpen: boolean;          // 한국 정규장 개장 여부
}

export class RiskManagerService {
  public evaluate(input: RiskManagerInput): RiskDecision {
    const ruleHits: string[] = [];

    // 킬스위치 — 즉시 전체 차단
    if (input.killSwitchEnabled) {
      ruleHits.push("KILL_SWITCH_ACTIVE");
    }

    // 장외 매수 차단 (손절용 매도는 허용)
    if (!input.marketOpen && input.side === "BUY") {
      ruleHits.push("MARKET_CLOSED");
    }

    // 일일 손실 한도 초과
    if (input.currentDailyLossPct <= -Math.abs(input.dailyLossLimitPct)) {
      ruleHits.push("DAILY_LOSS_LIMIT_REACHED");
    }

    // 동일 심볼/방향 중복 주문 방지
    if (input.hasDuplicateActiveOrder) {
      ruleHits.push("DUPLICATE_ACTIVE_ORDER");
    }

    // 신규 매수 시 최대 종목 수 초과 검사 (이미 보유 중인 심볼 추가 매수는 제외)
    if (input.side === "BUY" && !input.hasPosition && input.currentPositions >= input.maxPositions) {
      ruleHits.push("MAX_POSITIONS_REACHED");
    }

    // 리스크 예산 기반 수량 계산
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
