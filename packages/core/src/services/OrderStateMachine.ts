// ─────────────────────────────────────────────────────────────
// 주문 상태 전이 검증
// 허용되지 않는 상태 전이를 사전에 차단해 데이터 무결성을 보장한다.
//
// 허용 전이:
//   NEW           → PARTIALLY_FILLED, FILLED, CANCELED, REJECTED
//   PARTIALLY_FILLED → PARTIALLY_FILLED(추가 체결), FILLED, CANCELED
//   FILLED        → (종단 상태, 전이 불가)
//   CANCELED      → (종단 상태, 전이 불가)
//   REJECTED      → (종단 상태, 전이 불가)
// ─────────────────────────────────────────────────────────────

import type { ExecutionStatus } from "@trading/shared-domain";
import { AppError, ErrorCode } from "../errors/AppError.js";

const ALLOWED_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  NEW: ["PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELED"],
  FILLED: [],    // 종단 상태
  CANCELED: [],  // 종단 상태
  REJECTED: []   // 종단 상태
};

/**
 * 현재 상태에서 다음 상태로의 전이가 유효한지 검증한다.
 * 동일 상태로의 전이(같은 값)는 항상 허용된다 (PARTIALLY_FILLED 중복 이벤트 대응).
 * 유효하지 않으면 INVALID_ORDER_TRANSITION 에러를 던진다.
 */
export function assertOrderTransition(current: ExecutionStatus, next: ExecutionStatus): void {
  if (current === next) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new AppError(ErrorCode.INVALID_ORDER_TRANSITION, "Invalid order status transition", {
      current,
      next
    });
  }
}
