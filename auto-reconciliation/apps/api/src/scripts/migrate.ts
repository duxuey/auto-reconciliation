import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../db/client.js";
import { logger } from "../infra/logger.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

async function main(): Promise<void> {
  logger.info({ event: "db.migrate.start", migrationsFolder });
  await migrate(db, { migrationsFolder });
  logger.info({ event: "db.migrate.done" });
  await pool.end();
}

main().catch((error: unknown) => {
  logger.error({
    event: "db.migrate.failed",
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
