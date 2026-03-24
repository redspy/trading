// ─────────────────────────────────────────────────────────────
// 의존성 주입 컨테이너 (DI 부트스트랩)
//
// createCoreContext()는 모든 서비스와 리포지토리를 생성하고
// 의존성을 연결해 CoreContext 객체를 반환한다.
//
// 생성 순서:
//   DB → Repos → RuntimeFlags → MarketSession
//   → Strategy → RiskManager → KisClient → Broker
//   → ExecutionService → TradingOrchestrator
// ─────────────────────────────────────────────────────────────

import { KisRestClientImpl, type KisCredentials } from "@trading/kis-client";
import { AppDatabase } from "./db/Database.js";
import type { AppEnv } from "./config/env.js";
import { SqliteRepositories } from "./repo/SqliteRepositories.js";
import { ExecutionService } from "./services/ExecutionService.js";
import { KisBrokerGateway } from "./services/KisBrokerGateway.js";
import { KoreanMarketSession } from "./services/KoreanMarketSession.js";
import { PaperBrokerGateway } from "./services/PaperBrokerGateway.js";
import { RiskManagerService } from "./services/RiskManagerService.js";
import { RuntimeFlags } from "./services/RuntimeFlags.js";
import { TradingOrchestrator } from "./services/TradingOrchestrator.js";
import { TrendStrategyService } from "./services/TrendStrategyService.js";

/** 서버 전체 수명 동안 유지되는 핵심 컨텍스트 */
export interface CoreContext {
  env: AppEnv;
  db: AppDatabase;
  repos: SqliteRepositories;
  runtimeFlags: RuntimeFlags;
  marketSession: KoreanMarketSession;
  executionService: ExecutionService;
  tradingOrchestrator: TradingOrchestrator;
}

export function createCoreContext(env: AppEnv): CoreContext {
  const db = new AppDatabase(env.DATABASE_PATH);
  const repos = new SqliteRepositories(db.db);
  const runtimeFlags = new RuntimeFlags(env.KILL_SWITCH);
  const marketSession = new KoreanMarketSession();
  const strategyService = new TrendStrategyService();
  const riskManager = new RiskManagerService();

  const kisCredentials: KisCredentials = {
    appKey: env.KIS_APP_KEY,
    appSecret: env.KIS_APP_SECRET,
    accountNumber: env.KIS_ACCOUNT_NUMBER,
    productCode: env.KIS_PRODUCT_CODE,
    paperTrading: env.PAPER_MODE,
    baseUrl: env.KIS_BASE_URL,
    wsUrl: env.KIS_WS_URL
  };

  const kisClient = new KisRestClientImpl(kisCredentials);
  // PAPER_MODE이면 PaperBrokerGateway, 실거래이면 KisBrokerGateway 사용
  const broker = env.PAPER_MODE ? new PaperBrokerGateway() : new KisBrokerGateway(kisClient);

  const executionService = new ExecutionService(repos, repos, repos, broker, runtimeFlags, {
    paperMode: env.PAPER_MODE,
    liveMode: env.LIVE_MODE
  });

  const tradingOrchestrator = new TradingOrchestrator(
    env,
    repos,
    repos,
    repos,
    strategyService,
    riskManager,
    executionService,
    runtimeFlags,
    marketSession
  );

  return {
    env,
    db,
    repos,
    runtimeFlags,
    marketSession,
    executionService,
    tradingOrchestrator
  };
}
