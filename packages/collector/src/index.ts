import {
  KisRestClientImpl,
  KisWsClientImpl,
  type KisCredentials,
  type KisRestClient
} from "@trading/kis-client";
import type { ExecutionUpdate, MarketEvent } from "@trading/shared-domain";
import { z } from "zod";

const envSchema = z.object({
  INTERNAL_API_KEY: z.string().min(8).default("local-dev-api-key"),
  CORE_BASE_URL: z.string().url().default("http://localhost:4000"),
  WATCHLIST: z.string().default("005930,069500"),
  KIS_APP_KEY: z.string().default("demo-key"),
  KIS_APP_SECRET: z.string().default("demo-secret"),
  KIS_ACCOUNT_NUMBER: z.string().default("00000000"),
  KIS_PRODUCT_CODE: z.string().default("01"),
  KIS_BASE_URL: z.string().url().default("https://openapi.koreainvestment.com:9443"),
  KIS_WS_URL: z.string().url().default("wss://openapi.koreainvestment.com:21000"),
  PAPER_MODE: z
    .string()
    .default("true")
    .transform((value) => ["1", "true", "TRUE", "yes", "Y"].includes(value))
});

type Env = z.infer<typeof envSchema>;

class CoreInternalApi {
  public constructor(private readonly env: Env) {}

  public async pushMarketEvent(event: MarketEvent): Promise<void> {
    await this.post("/internal/market-events", event);
  }

  public async pushExecutionUpdate(update: ExecutionUpdate): Promise<void> {
    await this.post("/internal/execution-updates", update);
  }

  private async post(path: string, payload: unknown): Promise<void> {
    const response = await fetch(`${this.env.CORE_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": this.env.INTERNAL_API_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`core API error(${response.status}) ${path}: ${text}`);
    }
  }
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const coreApi = new CoreInternalApi(env);

  const credentials: KisCredentials = {
    appKey: env.KIS_APP_KEY,
    appSecret: env.KIS_APP_SECRET,
    accountNumber: env.KIS_ACCOUNT_NUMBER,
    productCode: env.KIS_PRODUCT_CODE,
    paperTrading: env.PAPER_MODE,
    baseUrl: env.KIS_BASE_URL,
    wsUrl: env.KIS_WS_URL
  };

  const restClient: KisRestClient = new KisRestClientImpl(credentials);
  const wsClient = new KisWsClientImpl(credentials, restClient, {
    onMarketEvent: async (event) => {
      await coreApi.pushMarketEvent(event);
    },
    onExecutionUpdate: async (update) => {
      await coreApi.pushExecutionUpdate(update);
    },
    onError: async (error) => {
      process.stdout.write(
        `${JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: error.message })}\n`
      );
    }
  });

  const symbols = env.WATCHLIST.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  await wsClient.start(symbols);
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "collector started", symbols })}\n`
  );

  const shutdown = async () => {
    await wsClient.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown().catch(() => process.exit(1));
  });
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
});
