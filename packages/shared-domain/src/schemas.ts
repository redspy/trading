// ─────────────────────────────────────────────────────────────
// 공유 도메인 Zod 스키마
// API 경계(HTTP 요청/응답)에서 런타임 타입 검증에 사용된다.
// 내부 서비스 간 호출에는 사용하지 않는다.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";

/** POST /internal/market-events 요청 바디 검증 */
export const marketEventSchema = z.object({
  symbol: z.string().min(1),
  ts: z.string().datetime(),
  price: z.number().positive(),
  volume: z.number().nonnegative(),
  source: z.enum(["WS", "REST"])
});

/** POST /internal/signals (내부 신호 검증, 확장용) */
export const tradeSignalSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  ts: z.string().datetime()
});

/** POST /internal/orders 요청 바디 검증 */
export const orderIntentSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  qty: z.number().int().positive(),
  type: z.enum(["MARKET", "LIMIT"]),
  price: z.number().positive().optional(),
  tif: z.enum(["DAY", "IOC", "FOK"]),
  clientOrderId: z.string().min(3)
});

/** POST /internal/execution-updates 요청 바디 검증 */
export const executionUpdateSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED"]),
  filledQty: z.number().int().nonnegative(),
  avgPrice: z.number().nonnegative(),
  ts: z.string().datetime()
});
