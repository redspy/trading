import { parseEnv } from "./config/env.js";
import { logger } from "./logging/logger.js";
import { createCoreContext } from "./bootstrap.js";
import { createApp } from "./api/createApp.js";

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const context = createCoreContext(env);
  const app = createApp(context);

  app.listen(env.PORT, () => {
    logger.info("core server started", {
      port: env.PORT,
      paperMode: env.PAPER_MODE,
      liveMode: env.LIVE_MODE,
      killSwitch: context.runtimeFlags.isKillSwitchEnabled(),
      marketSession: context.marketSession.getSession()
    });
  });

  // 체결 업데이트 동기화: 마지막 동기화 시각 기준으로 조회 (고정 30초 룩백 버그 수정)
  let lastSyncAt = new Date().toISOString();

  setInterval(async () => {
    const sinceIso = lastSyncAt;
    const applied = await context.executionService.syncOrderUpdates(sinceIso);
    lastSyncAt = new Date().toISOString();
    if (applied > 0) {
      logger.info("execution updates synced", { applied });
    }
  }, 5_000).unref();

  // 장 마감 처리: 15:30 KST 이후 당일 최초 1회만 실행
  let marketClosedToday = false;
  let lastCheckedDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  setInterval(async () => {
    const kstMs = Date.now() + 9 * 60 * 60 * 1000;
    const kst = new Date(kstMs);
    const todayKst = kst.toISOString().slice(0, 10);
    const hhmm = kst.getUTCHours() * 100 + kst.getUTCMinutes();

    // 자정(KST) 기준으로 플래그 초기화
    if (todayKst !== lastCheckedDate) {
      marketClosedToday = false;
      lastCheckedDate = todayKst;
    }

    if (!marketClosedToday && hhmm >= 1530) {
      marketClosedToday = true;

      const applied = await context.executionService.syncOrderUpdates(lastSyncAt);
      lastSyncAt = new Date().toISOString();
      if (applied > 0) {
        logger.info("end-of-day order sync", { applied });
      }

      const pnl = context.repos.getDailyPnl(todayKst);
      logger.info("end-of-day P&L", { ...pnl });
      context.repos.insertSystemEvent("EOD_PNL", "End-of-day P&L recorded", pnl);
    }
  }, 60_000).unref();
}

main().catch((error) => {
  logger.error("fatal startup error", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
