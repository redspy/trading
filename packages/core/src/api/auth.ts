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
