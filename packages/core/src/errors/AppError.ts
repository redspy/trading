// ─────────────────────────────────────────────────────────────
// 애플리케이션 에러 코드 및 커스텀 예외
// HTTP 상태 코드 매핑은 createApp.ts의 mapStatus()에서 처리된다.
// ─────────────────────────────────────────────────────────────

export enum ErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",         // 요청 바디 Zod 검증 실패
  UNAUTHORIZED_INTERNAL = "UNAUTHORIZED_INTERNAL", // x-internal-api-key 불일치
  ORDER_ALREADY_EXISTS = "ORDER_ALREADY_EXISTS",   // clientOrderId 중복 (409)
  ORDER_NOT_FOUND = "ORDER_NOT_FOUND",             // 주문 레코드 없음 (404)
  INVALID_ORDER_TRANSITION = "INVALID_ORDER_TRANSITION", // 허용되지 않는 주문 상태 전이
  RISK_BLOCKED = "RISK_BLOCKED",                   // 리스크 매니저 차단
  LIVE_MODE_BLOCKED = "LIVE_MODE_BLOCKED",         // 실거래 모드 설정 오류
  KILL_SWITCH_ACTIVE = "KILL_SWITCH_ACTIVE",       // 킬스위치 활성화 중
  INTERNAL_FAILURE = "INTERNAL_FAILURE"            // 예상치 못한 서버 오류
}

/** 구조화된 에러 코드와 상세 정보를 포함하는 애플리케이션 예외 */
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
