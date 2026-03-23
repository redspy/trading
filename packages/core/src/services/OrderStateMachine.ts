import type { ExecutionStatus } from "@trading/shared-domain";
import { AppError, ErrorCode } from "../errors/AppError.js";

const ALLOWED_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  NEW: ["PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELED"],
  FILLED: [],
  CANCELED: [],
  REJECTED: []
};

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
