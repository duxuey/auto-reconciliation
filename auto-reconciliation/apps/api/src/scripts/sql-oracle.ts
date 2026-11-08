import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "../db/client.js";
import { logger } from "../infra/logger.js";
import { getRunSummary, listRuns } from "../application/runs.js";

interface ExpectedMetric {
  code: string;
  result: string;
  total: number;
  fail: number;
}

interface ExpectedFile {
  packs: Record<string, ExpectedMetric[]>;
}

const expectedPath = fileURLToPath(
  new URL("../../../../fixtures/expected/seed-summary.json", import.meta.url)
);

async function main(): Promise<void> {
  const expected = JSON.parse(await readFile(expectedPath, "utf8")) as ExpectedFile;
  const runs = await listRuns({ limit: 200 });
  const mismatches: Array<{
    packCode: string;
    metricCode: string;
    expected: ExpectedMetric | null;
    actual: { result: string; total: number; fail: number } | null;
  }> = [];

  for (const [packCode, expectedMetrics] of Object.entries(expected.packs)) {
    const run = runs.find(
      (item) => item.packCode === packCode && item.run.runStatus === "SUCCEEDED"
    );
    if (run === undefined) {
      mismatches.push({
        packCode,
        metricCode: "*",
        expected: null,
        actual: null
      });
      continue;
    }
    const summary = await getRunSummary(run.run.id);
    const actualByCode = new Map(
      summary.metrics.map((metric) => [
        metric.metricCode,
        {
          result: metric.checkResult,
          total: metric.totalCount,
          fail: metric.failCount
        }
      ])
    );
    for (const expectedMetric of expectedMetrics) {
      const actual = actualByCode.get(expectedMetric.code) ?? null;
      if (
        actual === null ||
        actual.result !== expectedMetric.result ||
        actual.total !== expectedMetric.total ||
        actual.fail !== expectedMetric.fail
      ) {
        mismatches.push({
          packCode,
          metricCode: expectedMetric.code,
          expected: expectedMetric,
          actual
        });
      }
    }
    logger.info({
      event: "oracle.pack",
      packCode,
      runNo: run.run.runNo,
      expectedMetrics: expectedMetrics.length,
      matched: mismatches.every((item) => item.packCode !== packCode)
    });
  }

  if (mismatches.length > 0) {
    logger.error({ event: "oracle.failed", mismatches });
    process.exitCode = 1;
    return;
  }
  logger.info({ event: "oracle.passed", packs: Object.keys(expected.packs).length });
}

main()
  .catch((error: unknown) => {
    logger.error({
      event: "oracle.error",
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
