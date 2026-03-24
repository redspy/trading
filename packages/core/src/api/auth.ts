// ─────────────────────────────────────────────────────────────
// 내부 API 인증 미들웨어
// collector → core 간 내부 통신에 사용되는 단순 API 키 검증.
// 헤더: x-internal-api-key
// ─────────────────────────────────────────────────────────────

import type { NextFunction, Request, Response } from "express";
import { AppError, ErrorCode } from "../errors/AppError.js";

export function internalAuth(expectedApiKey: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const provided = req.header("x-internal-api-key");
    if (!provided || provided !== expectedApiKey) {
      next(new AppError(ErrorCode.UNAUTHORIZED_INTERNAL, "Invalid internal API key"));
      return;
    }
    next();
  };
}
