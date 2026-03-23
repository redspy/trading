import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    return ["1", "true", "TRUE", "yes", "Y"].includes(value);
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  INTERNAL_API_KEY: z.string().min(8).default("local-dev-api-key"),
  DATABASE_PATH: z.string().default("./trading.sqlite"),
  PAPER_MODE: booleanFromEnv.default("true").transform(Boolean),
  LIVE_MODE: booleanFromEnv.default("false").transform(Boolean),
  KILL_SWITCH: booleanFromEnv.default("true").transform(Boolean),
  RISK_PER_TRADE_PCT: z.coerce.number().positive().max(0.05).default(0.005),
  DAILY_LOSS_LIMIT_PCT: z.coerce.number().positive().max(0.2).default(0.02),
  FIXED_STOP_LOSS_PCT: z.coerce.number().positive().max(0.2).default(0.025),
  MAX_POSITIONS: z.coerce.number().int().positive().default(5),
  ACCOUNT_EQUITY: z.coerce.number().positive().default(100_000_000),
  WATCHLIST: z.string().default("005930,069500"),
  KIS_APP_KEY: z.string().default("demo-key"),
  KIS_APP_SECRET: z.string().default("demo-secret"),
  KIS_ACCOUNT_NUMBER: z.string().default("00000000"),
  KIS_PRODUCT_CODE: z.string().default("01"),
  KIS_BASE_URL: z.string().url().default("https://openapi.koreainvestment.com:9443"),
  KIS_WS_URL: z.string().url().default("wss://openapi.koreainvestment.com:21000")
});

export type AppEnv = z.infer<typeof envSchema> & {
  watchlistSymbols: string[];
};

export function parseEnv(rawEnv: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(rawEnv);
  const watchlistSymbols = parsed.WATCHLIST.split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  return {
    ...parsed,
    watchlistSymbols
  };
}
