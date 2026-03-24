// ─────────────────────────────────────────────────────────────
// Express 앱 생성 및 내부 API 라우트 정의
//
// 공개 엔드포인트:
//   GET  /health                   — 헬스체크 (인증 불필요)
//
// 내부 엔드포인트 (x-internal-api-key 헤더 필요):
//   GET  /internal/preflight       — 운영 전 사전 점검 상태 조회
//   POST /internal/market-events   — 시세 이벤트 수신 (단건/배열)
//   POST /internal/orders          — 수동 주문 접수
//   POST /internal/execution-updates — 체결 업데이트 수신 (단건/배열)
//   POST /internal/killswitch/enable|disable — 킬스위치 제어
//   GET  /internal/positions       — 현재 포지션 조회
//   GET  /internal/pnl             — 일손익 조회 (?date=YYYY-MM-DD)
//   GET  /internal/orders/:id      — 주문 상세 조회
//
// 에러 처리:
//   ZodError     → 400 VALIDATION_FAILED
//   AppError     → mapStatus()로 HTTP 상태 코드 매핑
//   기타 예외    → 500 INTERNAL_FAILURE
// ─────────────────────────────────────────────────────────────

import express, { type NextFunction, type Request, type Response } from "express";
import {
  executionUpdateSchema,
  marketEventSchema,
  orderIntentSchema,
  type ExecutionUpdate,
  type MarketEvent,
  type OrderIntent
} from "@trading/shared-domain";
import { z } from "zod";
import { AppError, ErrorCode } from "../errors/AppError.js";
import type { CoreContext } from "../bootstrap.js";
import { internalAuth } from "./auth.js";

// 단건 또는 배열 모두 허용
const marketEventPayloadSchema = z.union([marketEventSchema, z.array(marketEventSchema)]);
const executionPayloadSchema = z.union([executionUpdateSchema, z.array(executionUpdateSchema)]);

export function createApp(context: CoreContext) {
  const app = express();
  app.use(express.json());

  // ─── 공개 엔드포인트 ─────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, time: new Date().toISOString() });
  });

  // ─── 내부 API (인증 미들웨어) ────────────────────────────

  app.use("/internal", internalAuth(context.env.INTERNAL_API_KEY));

  /**
   * GET /internal/preflight
   * 운영 시작 전 시스템 상태를 점검한다.
   * checks.marketSession으로 현재 한국장 세션 상태를 확인할 수 있다.
   */
  app.get("/internal/preflight", (_req, res) => {
    res.status(200).json({
      ok: true,
      checks: {
        db: true,
        killSwitch: context.runtimeFlags.isKillSwitchEnabled(),
        paperMode: context.env.PAPER_MODE,
        liveMode: context.env.LIVE_MODE,
        accountEquity: context.env.ACCOUNT_EQUITY,
        watchlistCount: context.env.watchlistSymbols.length,
        marketSession: context.marketSession.getSession()
      }
    });
  });

  /**
   * POST /internal/market-events
   * collector가 KIS WS에서 수신한 시세 이벤트를 전달한다.
   * 단건 또는 배열로 전송 가능.
   * 응답: { processed: N, blocked: M }
   *   - blocked: 리스크 규칙 차단된 이벤트 수
   */
  app.post("/internal/market-events", async (req, res, next) => {
    try {
      const payload = marketEventPayloadSchema.parse(req.body);
      const events = (Array.isArray(payload) ? payload : [payload]) as MarketEvent[];

      let processed = 0;
      let blocked = 0;

      for (const event of events) {
        try {
          await context.tradingOrchestrator.onMarketEvent(event);
          processed += 1;
        } catch (error) {
          if (error instanceof AppError && error.code === ErrorCode.RISK_BLOCKED) {
            blocked += 1;
            continue;
          }
          throw error;
        }
      }

      res.status(202).json({ processed, blocked });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /internal/orders
   * 수동으로 주문을 접수한다 (전략 엔진 우회).
   * 응답: OrderRecord (201)
   */
  app.post("/internal/orders", async (req, res, next) => {
    try {
      const payload = orderIntentSchema.parse(req.body);
      const orderIntent: OrderIntent =
        payload.price === undefined
          ? {
              symbol: payload.symbol,
              side: payload.side,
              qty: payload.qty,
              type: payload.type,
              tif: payload.tif,
              clientOrderId: payload.clientOrderId
            }
          : {
              symbol: payload.symbol,
              side: payload.side,
              qty: payload.qty,
              type: payload.type,
              price: payload.price,
              tif: payload.tif,
              clientOrderId: payload.clientOrderId
            };
      const order = await context.executionService.placeOrder(orderIntent);
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /internal/execution-updates
   * KIS WS 또는 REST 폴링에서 수신한 체결 업데이트를 적용한다.
   * 응답: { applied: N }
   */
  app.post("/internal/execution-updates", (req, res, next) => {
    try {
      const payload = executionPayloadSchema.parse(req.body);
      const updates = (Array.isArray(payload) ? payload : [payload]) as ExecutionUpdate[];
      for (const update of updates) {
        context.executionService.onExecutionUpdate(update);
      }
      res.status(202).json({ applied: updates.length });
    } catch (error) {
      next(error);
    }
  });

  /** POST /internal/killswitch/enable — 킬스위치 활성화 */
  app.post("/internal/killswitch/enable", (_req, res) => {
    context.runtimeFlags.enableKillSwitch();
    res.status(200).json({ killSwitch: true });
  });

  /** POST /internal/killswitch/disable — 킬스위치 해제 */
  app.post("/internal/killswitch/disable", (_req, res) => {
    context.runtimeFlags.disableKillSwitch();
    res.status(200).json({ killSwitch: false });
  });

  /** GET /internal/positions — 현재 보유 포지션 목록 */
  app.get("/internal/positions", (_req, res) => {
    res.status(200).json(context.repos.list());
  });

  /**
   * GET /internal/pnl — 일손익 조회
   * 쿼리 파라미터: ?date=YYYY-MM-DD (없으면 오늘)
   */
  app.get("/internal/pnl", (req, res) => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(req.query.date);
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    res.status(200).json(context.repos.getDailyPnl(targetDate));
  });

  /** GET /internal/orders/:id — 주문 레코드 조회 */
  app.get("/internal/orders/:id", (req, res, next) => {
    try {
      const order = context.executionService.getOrder(req.params.id);
      res.status(200).json(order);
    } catch (error) {
      next(error);
    }
  });

  // ─── 전역 에러 핸들러 ─────────────────────────────────────

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: ErrorCode.VALIDATION_FAILED,
        message: "Validation failed",
        details: error.issues
      });
      return;
    }

    if (error instanceof AppError) {
      const status = mapStatus(error.code);
      res.status(status).json({
        error: error.code,
        message: error.message,
        details: error.details
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      error: ErrorCode.INTERNAL_FAILURE,
      message
    });
  });

  return app;
}

/** ErrorCode → HTTP 상태 코드 매핑 */
function mapStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.VALIDATION_FAILED:
      return 400;
    case ErrorCode.UNAUTHORIZED_INTERNAL:
      return 401;
    case ErrorCode.ORDER_NOT_FOUND:
      return 404;
    case ErrorCode.ORDER_ALREADY_EXISTS:
      return 409;
    case ErrorCode.RISK_BLOCKED:
    case ErrorCode.KILL_SWITCH_ACTIVE:
    case ErrorCode.LIVE_MODE_BLOCKED:
    case ErrorCode.INVALID_ORDER_TRANSITION:
      return 422;
    default:
      return 500;
  }
}
