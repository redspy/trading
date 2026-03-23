import { z } from "zod";

export const marketEventSchema = z.object({
  symbol: z.string().min(1),
  ts: z.string().datetime(),
  price: z.number().positive(),
  volume: z.number().nonnegative(),
  source: z.enum(["WS", "REST"])
});

export const tradeSignalSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  ts: z.string().datetime()
});

export const orderIntentSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  qty: z.number().int().positive(),
  type: z.enum(["MARKET", "LIMIT"]),
  price: z.number().positive().optional(),
  tif: z.enum(["DAY", "IOC", "FOK"]),
  clientOrderId: z.string().min(3)
});

export const executionUpdateSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED"]),
  filledQty: z.number().int().nonnegative(),
  avgPrice: z.number().nonnegative(),
  ts: z.string().datetime()
});
