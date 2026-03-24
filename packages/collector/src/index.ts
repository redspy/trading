// ─────────────────────────────────────────────────────────────
// KIS 데이터 수집기 (Collector)
//
// 역할:
//   KIS WebSocket에서 실시간 시세/체결 이벤트를 수신하여
//   core 서버의 내부 API로 전달한다.
//
// 아키텍처:
//   KIS WS → KisWsClientImpl → CoreInternalApi → core 서버
//
// 이벤트 흐름:
//   onMarketEvent  → POST /internal/market-events
//   onExecutionUpdate → POST /internal/execution-updates
//
// 종료 처리:
//   SIGINT/SIGTERM 수신 시 WS 연결을 정상 종료한다.
// ─────────────────────────────────────────────────────────────

import {
  KisRestClientImpl,
  KisWsClientImpl,
  MockKisRestClient,
  MockKisWsClient,
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
    .transform((value) => ["1", "true", "TRUE", "yes", "Y"].includes(value)),
  KIS_MOCK: z
    .string()
    .default("false")
    .transform((value) => ["1", "true", "TRUE", "yes", "Y"].includes(value))
});

type Env = z.infer<typeof envSchema>;

/** core 서버 내부 API 클라이언트 */
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

  const restClient: KisRestClient = env.KIS_MOCK
    ? new MockKisRestClient()
    : new KisRestClientImpl(credentials);

  const wsClient = env.KIS_MOCK
    ? new MockKisWsClient(credentials, restClient, {
        onMarketEvent: async (event) => {
          await coreApi.pushMarketEvent(event);
        },
        onExecutionUpdate: async (update) => {
          await coreApi.pushExecutionUpdate(update);
        }
      })
    : new KisWsClientImpl(credentials, restClient, {
        onMarketEvent: async (event) => {
          await coreApi.pushMarketEvent(event);
        },
        onExecutionUpdate: async (update) => {
          await coreApi.pushExecutionUpdate(update);
        },
        onError: async (error) => {
          // 에러는 stderr로 출력 (JSON 구조화 로그)
          process.stderr.write(
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

  // SIGINT(Ctrl+C) / SIGTERM(컨테이너 종료) 수신 시 정상 종료
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
