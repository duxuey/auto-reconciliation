import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { recoverStaleJobs } from "./application/job-runner.js";
import { recoverStaleCheckRuns } from "./application/runs.js";
import {
  startAutomationScheduler,
  stopAutomationScheduler
} from "./application/automation-scheduler.js";
import { config } from "./config.js";
import { pool } from "./db/client.js";
import { logger } from "./infra/logger.js";

export { createApp } from "./app.js";
export { routeContracts } from "./rest/contracts.js";
export { appRouter, type AppRouter } from "./trpc/router.js";

const app = createApp();

const server = serve(
  {
    fetch: app.fetch,
    port: config.PORT,
    hostname: "127.0.0.1"
  },
  (info) => {
    logger.info({ event: "api.started", port: info.port, env: config.NODE_ENV });
  }
);

void (async () => {
  await recoverStaleJobs();
  await recoverStaleCheckRuns();
  await startAutomationScheduler();
})().catch((error: unknown) => {
  logger.warn({
    event: "startup.recover.failed",
    error: error instanceof Error ? error.message : String(error)
  });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ event: "api.shutdown.begin", signal });
  await stopAutomationScheduler();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await pool.end();
  logger.info({ event: "api.shutdown.done", signal });
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
