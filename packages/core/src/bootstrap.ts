import { KisRestClientImpl, type KisCredentials } from "@trading/kis-client";
import { AppDatabase } from "./db/Database.js";
import type { AppEnv } from "./config/env.js";
import { SqliteRepositories } from "./repo/SqliteRepositories.js";
import { ExecutionService } from "./services/ExecutionService.js";
import { KisBrokerGateway } from "./services/KisBrokerGateway.js";
import { PaperBrokerGateway } from "./services/PaperBrokerGateway.js";
import { RiskManagerService } from "./services/RiskManagerService.js";
import { RuntimeFlags } from "./services/RuntimeFlags.js";
import { TradingOrchestrator } from "./services/TradingOrchestrator.js";
import { TrendStrategyService } from "./services/TrendStrategyService.js";

export interface CoreContext {
  env: AppEnv;
  db: AppDatabase;
  repos: SqliteRepositories;
  runtimeFlags: RuntimeFlags;
  executionService: ExecutionService;
  tradingOrchestrator: TradingOrchestrator;
}

export function createCoreContext(env: AppEnv): CoreContext {
  const db = new AppDatabase(env.DATABASE_PATH);
  const repos = new SqliteRepositories(db.db);
  const runtimeFlags = new RuntimeFlags(env.KILL_SWITCH);
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
    runtimeFlags
  );

  return {
    env,
    db,
    repos,
    runtimeFlags,
    executionService,
    tradingOrchestrator
  };
}
