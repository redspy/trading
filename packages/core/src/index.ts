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
      killSwitch: context.runtimeFlags.isKillSwitchEnabled()
    });
  });

  setInterval(async () => {
    const sinceIso = new Date(Date.now() - 30_000).toISOString();
    const applied = await context.executionService.syncOrderUpdates(sinceIso);
    if (applied > 0) {
      logger.info("execution updates synced", { applied });
    }
  }, 5_000).unref();
}

main().catch((error) => {
  logger.error("fatal startup error", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
