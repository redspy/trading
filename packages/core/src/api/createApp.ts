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

const marketEventPayloadSchema = z.union([marketEventSchema, z.array(marketEventSchema)]);
const executionPayloadSchema = z.union([executionUpdateSchema, z.array(executionUpdateSchema)]);

export function createApp(context: CoreContext) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, time: new Date().toISOString() });
  });

  app.use("/internal", internalAuth(context.env.INTERNAL_API_KEY));

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

  app.post("/internal/killswitch/enable", (_req, res) => {
    context.runtimeFlags.enableKillSwitch();
    res.status(200).json({ killSwitch: true });
  });

  app.post("/internal/killswitch/disable", (_req, res) => {
    context.runtimeFlags.disableKillSwitch();
    res.status(200).json({ killSwitch: false });
  });

  app.get("/internal/positions", (_req, res) => {
    res.status(200).json(context.repos.list());
  });

  app.get("/internal/pnl", (req, res) => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(req.query.date);
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    res.status(200).json(context.repos.getDailyPnl(targetDate));
  });

  app.get("/internal/orders/:id", (req, res, next) => {
    try {
      const order = context.executionService.getOrder(req.params.id);
      res.status(200).json(order);
    } catch (error) {
      next(error);
    }
  });

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
