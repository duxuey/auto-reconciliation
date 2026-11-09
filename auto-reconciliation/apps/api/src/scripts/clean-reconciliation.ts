import { config } from "../config.js";
import { pool } from "../db/client.js";
import { logger } from "../infra/logger.js";

/**
 * 清理当前租户的指标包与对账执行记录。
 *
 * 默认只统计（dry-run）；传入 `--yes` 才在事务内删除。
 * 保留环境、系统、环境 schema、对账关系、数据集、导入/暂存数据和自动化调度配置。
 */
const TENANT_TABLES = [
  "biz_reconciliation_check_diff_log",
  "biz_reconciliation_adjustment",
  "biz_reconciliation_check_diff",
  "biz_reconciliation_check_metric_result",
  "biz_reconciliation_check_gate",
  "biz_reconciliation_automation_run",
  "biz_reconciliation_check_run",
  "biz_reconciliation_job"
] as const;

const PACK_VERSION_TABLE = "biz_reconciliation_check_pack_version";
const PACK_TABLE = "biz_reconciliation_check_pack";

type CountRow = { count: string };

async function countRows(sql: string): Promise<number> {
  const result = await pool.query<CountRow>(sql, [config.TENANT_ID]);
  return Number(result.rows[0]?.count ?? "0");
}

async function collectCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    counts[table] = await countRows(
      `SELECT count(*)::text AS count FROM ${table} WHERE tenant_id = $1`
    );
  }
  counts[PACK_VERSION_TABLE] = await countRows(
    `SELECT count(*)::text AS count FROM ${PACK_VERSION_TABLE} v ` +
      `JOIN ${PACK_TABLE} p ON p.id = v.pack_id WHERE p.tenant_id = $1`
  );
  counts[PACK_TABLE] = await countRows(
    `SELECT count(*)::text AS count FROM ${PACK_TABLE} WHERE tenant_id = $1`
  );
  return counts;
}

async function deleteRows(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of TENANT_TABLES) {
      const result = await client.query(
        `DELETE FROM ${table} WHERE tenant_id = $1`,
        [config.TENANT_ID]
      );
      deleted[table] = result.rowCount ?? 0;
    }
    const versions = await client.query(
      `DELETE FROM ${PACK_VERSION_TABLE} WHERE pack_id IN (` +
        `SELECT id FROM ${PACK_TABLE} WHERE tenant_id = $1)`,
      [config.TENANT_ID]
    );
    deleted[PACK_VERSION_TABLE] = versions.rowCount ?? 0;
    const packs = await client.query(
      `DELETE FROM ${PACK_TABLE} WHERE tenant_id = $1`,
      [config.TENANT_ID]
    );
    deleted[PACK_TABLE] = packs.rowCount ?? 0;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return deleted;
}

async function main(): Promise<void> {
  const confirmed = process.argv.includes("--yes");
  const counts = await collectCounts();
  logger.info({ event: "clean.counts", tenantId: config.TENANT_ID, counts });

  if (!confirmed) {
    logger.info({
      event: "clean.dryRun",
      hint: "未执行删除；确认后追加 --yes 重新运行"
    });
    return;
  }

  const deleted = await deleteRows();
  logger.info({ event: "clean.done", tenantId: config.TENANT_ID, deleted });
}

main()
  .catch((error: unknown) => {
    logger.error({
      event: "clean.failed",
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
