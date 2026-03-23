export enum ErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  UNAUTHORIZED_INTERNAL = "UNAUTHORIZED_INTERNAL",
  ORDER_ALREADY_EXISTS = "ORDER_ALREADY_EXISTS",
  ORDER_NOT_FOUND = "ORDER_NOT_FOUND",
  INVALID_ORDER_TRANSITION = "INVALID_ORDER_TRANSITION",
  RISK_BLOCKED = "RISK_BLOCKED",
  LIVE_MODE_BLOCKED = "LIVE_MODE_BLOCKED",
  KILL_SWITCH_ACTIVE = "KILL_SWITCH_ACTIVE",
  INTERNAL_FAILURE = "INTERNAL_FAILURE"
}

export class AppError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}
