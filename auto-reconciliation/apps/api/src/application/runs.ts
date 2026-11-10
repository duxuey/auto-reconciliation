import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import {
  ENGINE_VERSION,
  parsePackConfig,
  runPack,
  type PackConfig,
  type ToleranceConfig
} from "@infra/biz-reconciliation-engine";
import type { NormalizedRecord, Side } from "@shared/types";
import { sha256, stableJson, truncate } from "@shared/utils";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  checkDiff,
  checkMetricResult,
  checkPack,
  checkPackVersion,
  checkRun,
  importBatch,
  stagingRecord
} from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import { assertTransition } from "../domain/status.js";
import { logger } from "../infra/logger.js";
import { requireRow } from "../infra/require.js";
import { getPackById, getPackVersionById, getPublishedVersion } from "./catalog.js";
import { resolveEnvironment } from "./environments.js";
import { decidePackExecution, type PackDatasetOutcome } from "./extraction.js";
import { refreshGateForStage } from "./gates.js";
import { extractDatasetDirect, type ExtractDatasetResult } from "./imports.js";
import { startJob } from "./job-runner.js";
import { getPairReadiness } from "./readiness.js";

export type RunMode = "FULL" | "DRY_RUN";

export interface CreateRunInput {
  packId: string;
  environmentId?: string;
  periodStartDate: string;
  periodEndDate: string;
  runMode: RunMode;
  toleranceOverride?: ToleranceConfig;
  actor: string;
  defer?: boolean;
  /** 显式限定本次执行使用的抽取批次（直连/暂存编排传入，不暴露到 REST/tRPC） */
  batchIds?: string[];
}

const manifestSchema = z.object({
  environmentId: z.string().optional(),
  pairId: z.string().optional(),
  datasetCodes: z.array(z.string()),
  batchIds: z.array(z.string()),
  toleranceOverride: z
    .object({ abs: z.string(), rel: z.string().optional() })
    .optional(),
  versionNo: z.number(),
  engineVersion: z.string().optional()
});

type RunManifest = z.infer<typeof manifestSchema>;

function datasetSides(packConfig: PackConfig): Map<string, Side> {
  const sides = new Map<string, Side>();
  for (const comparison of packConfig.comparisons) {
    const pairs: Array<[Side, string | string[]]> = [
      ["LEFT", comparison.leftDataset],
      ["RIGHT", comparison.rightDataset]
    ];
    for (const [side, reference] of pairs) {
      const codes = Array.isArray(reference) ? reference : [reference];
      for (const code of codes) {
        const existing = sides.get(code);
        if (existing !== undefined && existing !== side) {
          throw new AppError(
            "BIZ_RECONCILIATION_RUN_INVALID_INPUT",
            `数据集 ${code} 同时出现在左右两侧`
          );
        }
        sides.set(code, side);
      }
    }
  }
  return sides;
}

function applyToleranceOverride(
  packConfig: PackConfig,
  override: ToleranceConfig | undefined
): PackConfig {
  if (override === undefined) {
    return packConfig;
  }
  return {
    ...packConfig,
    defaults: { ...packConfig.defaults, tolerance: override },
    comparisons: packConfig.comparisons.map((comparison) => ({
      ...comparison,
      metrics: comparison.metrics.map((metric) => {
        const { tolerance: _ignored, ...rest } = metric;
        return rest;
      })
    }))
  };
}

async function stagingRowsForPeriod(
  datasetCodes: string[],
  periodStartDate: string,
  periodEndDate: string,
  environmentId?: string | null,
  batchIds?: string[]
) {
  if (datasetCodes.length === 0) {
    return [];
  }
  // 空批次集合表示本次没有抽取到任何数据，不能回退成“查全部批次”
  if (batchIds !== undefined && batchIds.length === 0) {
    return [];
  }
  const conditions = [
    eq(stagingRecord.tenantId, config.TENANT_ID),
    inArray(stagingRecord.datasetCode, datasetCodes),
    gte(stagingRecord.businessDate, periodStartDate),
    lte(stagingRecord.businessDate, periodEndDate),
    isNull(stagingRecord.deletedAt)
  ];
  if (batchIds !== undefined) {
    conditions.push(inArray(stagingRecord.importBatchId, batchIds));
  }
  if (environmentId !== undefined && environmentId !== null && environmentId !== "") {
    conditions.push(eq(stagingRecord.environmentId, environmentId));
  }
  return db
    .select()
    .from(stagingRecord)
    .where(and(...conditions))
    .orderBy(stagingRecord.datasetCode, stagingRecord.businessKeyText);
}

export async function getRunById(id: string) {
  const rows = await db
    .select()
    .from(checkRun)
    .where(
      and(
        eq(checkRun.tenantId, config.TENANT_ID),
        eq(checkRun.id, id),
        isNull(checkRun.deletedAt)
      )
    )
    .limit(1);
  const run = rows[0];
  if (run === undefined) {
    throw new AppError("BIZ_RECONCILIATION_RUN_NOT_FOUND", `执行批次 ${id} 不存在`);
  }
  return run;
}

export async function createRun(input: CreateRunInput) {
  if (input.periodStartDate > input.periodEndDate) {
    throw new AppError(
      "BIZ_RECONCILIATION_RUN_INVALID_INPUT",
      "期间起日不能晚于止日"
    );
  }
  const pack = await getPackById(input.packId);
  if (pack.packStatus !== "ACTIVE") {
    throw new AppError(
      "BIZ_RECONCILIATION_RUN_INVALID_INPUT",
      `指标包 ${pack.packCode} 未激活`
    );
  }
  const version = await getPublishedVersion(input.packId);
  const packConfig = parsePackConfig(version.configJson);
  const sides = datasetSides(packConfig);
  const datasetCodes = [...sides.keys()];
  const environment = await resolveEnvironment({
    environmentId: input.environmentId
  });

  const requestedBatchIds =
    input.batchIds === undefined ? undefined : [...new Set(input.batchIds)].sort();
  const staging = await stagingRowsForPeriod(
    datasetCodes,
    input.periodStartDate,
    input.periodEndDate,
    environment.id,
    requestedBatchIds
  );
  if (staging.length === 0) {
    throw new AppError(
      "BIZ_RECONCILIATION_RUN_INVALID_INPUT",
      requestedBatchIds === undefined
        ? "期间内没有可对账的数据"
        : "本次抽取值没有可对账的数据"
    );
  }
  if (config.MAX_RUN_ROWS > 0 && staging.length > config.MAX_RUN_ROWS * 2) {
    throw new AppError(
      "BIZ_RECONCILIATION_RUN_INVALID_INPUT",
      `期间内暂存记录 ${staging.length} 条，超过单次执行上限 ${config.MAX_RUN_ROWS * 2}`
    );
  }

  const batchIds =
    requestedBatchIds ?? [...new Set(staging.map((row) => row.importBatchId))].sort();
  const manifest: RunManifest = {
    environmentId: environment.id,
    pairId: pack.pairId ?? undefined,
    datasetCodes,
    batchIds,
    toleranceOverride: input.toleranceOverride,
    versionNo: version.versionNo,
    engineVersion: ENGINE_VERSION
  };
  const inputFingerprint = sha256(
    stableJson({
      environmentId: environment.id,
      pairId: pack.pairId ?? null,
      packVersionId: version.id,
      engineVersion: ENGINE_VERSION,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      batchIds,
      toleranceOverride: input.toleranceOverride ?? null,
      runMode: input.runMode
    })
  );

  const existing = await db
    .select()
    .from(checkRun)
    .where(
      and(
        eq(checkRun.tenantId, config.TENANT_ID),
        eq(checkRun.inputFingerprint, inputFingerprint),
        isNull(checkRun.deletedAt)
      )
    )
    .limit(1);
  let runId: string;
  let created: boolean;
  if (existing[0] !== undefined) {
    // 唯一指纹索引不允许新建同输入批次；失败的批次按相同输入重试，
    // 否则一次偶发失败会让该期间永久停留在 FAILED。
    if (existing[0].runStatus !== "FAILED") {
      return { run: existing[0], created: false as const };
    }
    const [reset] = await db
      .update(checkRun)
      .set({
        runStatus: "PENDING",
        failureCode: null,
        failureMessage: null,
        startedAt: null,
        finishedAt: null,
        updatedBy: input.actor,
        updatedAt: sql`now()`
      })
      .where(
        and(
          eq(checkRun.tenantId, config.TENANT_ID),
          eq(checkRun.id, existing[0].id),
          eq(checkRun.runStatus, "FAILED")
        )
      )
      .returning({ id: checkRun.id });
    if (reset === undefined) {
      return { run: await getRunById(existing[0].id), created: false as const };
    }
    runId = reset.id;
    created = false;
  } else {
    runId = ulid();
    const [inserted] = await db
      .insert(checkRun)
      .values({
        id: runId,
        tenantId: config.TENANT_ID,
        runNo: `RC${input.periodStartDate.replaceAll("-", "")}${runId.slice(-6)}`,
        packId: input.packId,
        packVersionId: version.id,
        environmentId: environment.id,
        pairId: pack.pairId ?? null,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        runMode: input.runMode,
        runStatus: "PENDING",
        inputFingerprint,
        inputManifestExt: manifest,
        metricTotal: 0,
        failMetricCount: 0,
        jobId: null,
        createdBy: input.actor,
        updatedBy: input.actor
      })
      .returning();
    requireRow(inserted, "执行批次创建失败");
    created = true;
  }

  if (input.defer === false) {
    const finished = await executeRun(runId, input.actor);
    return { run: finished, created };
  }

  const jobId = await startJob({
    jobType: "RUN",
    refType: "RUN",
    refId: runId,
    // 重试时原幂等键已完成，需用新键重新排队
    idempotencyKey: created ? `run:${runId}` : `run:${runId}:retry:${ulid()}`,
    actor: input.actor,
    handler: async () => {
      const finished = await executeRun(runId, input.actor);
      return {
        runId,
        runStatus: finished.runStatus,
        metricTotal: finished.metricTotal,
        failMetricCount: finished.failMetricCount
      };
    }
  });
  const [withJob] = await db
    .update(checkRun)
    .set({ jobId, updatedBy: input.actor, updatedAt: sql`now()` })
    .where(and(eq(checkRun.tenantId, config.TENANT_ID), eq(checkRun.id, runId)))
    .returning();
  return { run: requireRow(withJob, "执行批次作业关联失败"), created };
}

function toNormalizedRecord(
  row: typeof stagingRecord.$inferSelect,
  side: Side
): NormalizedRecord {
  return {
    side,
    datasetCode: row.datasetCode,
    sourceSystem: row.sourceSystem,
    externalId: row.externalId,
    periodCode: row.periodCode ?? "",
    businessKey: row.businessKeyExt,
    amounts: row.amountsExt,
    currency: row.currency,
    businessDate: row.businessDate,
    recordStatus: row.recordStatus,
    attributes: row.attributesExt
  };
}

export async function executeRun(runId: string, actor: string) {
  const run = await getRunById(runId);
  if (run.runStatus === "CANCELLED") {
    return run;
  }
  const claimed = await db
    .update(checkRun)
    .set({
      runStatus: "RUNNING",
      startedAt: sql`now()`,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(
      and(
        eq(checkRun.tenantId, config.TENANT_ID),
        eq(checkRun.id, runId),
        eq(checkRun.runStatus, "PENDING")
      )
    )
    .returning();
  if (claimed.length === 0) {
    return getRunById(runId);
  }

  try {
    await getPackById(run.packId);
    const version = await getPackVersionById(run.packVersionId);
    const parsedConfig = parsePackConfig(version.configJson);
    const manifest = manifestSchema.parse(run.inputManifestExt);
    const effectiveConfig = applyToleranceOverride(parsedConfig, manifest.toleranceOverride);
    const sides = datasetSides(effectiveConfig);
    const datasetCodes = [...sides.keys()];
    // 只加载本执行声明的批次，避免后续新抽取污染历史执行与来源钻取
    const rows = await stagingRowsForPeriod(
      datasetCodes,
      run.periodStartDate,
      run.periodEndDate,
      run.environmentId,
      manifest.batchIds
    );
    const records: NormalizedRecord[] = [];
    for (const row of rows) {
      const side = sides.get(row.datasetCode);
      if (side === undefined) {
        continue;
      }
      records.push(toNormalizedRecord(row, side));
    }

    const result = runPack(effectiveConfig, records);
    const failMetricCount = result.metrics.filter(
      (metric) => metric.checkResult === "FAIL"
    ).length;

    await db.transaction(async (tx) => {
      // 先以 RUNNING 为条件推进状态：取消/并发执行时不会覆盖 CANCELLED
      const claimedForSuccess = await tx
        .update(checkRun)
        .set({
          runStatus: "SUCCEEDED",
          metricTotal: result.metrics.length,
          failMetricCount,
          finishedAt: sql`now()`,
          updatedBy: actor,
          updatedAt: sql`now()`
        })
        .where(
          and(
            eq(checkRun.tenantId, config.TENANT_ID),
            eq(checkRun.id, runId),
            eq(checkRun.runStatus, "RUNNING")
          )
        )
        .returning({ id: checkRun.id });
      if (claimedForSuccess.length === 0) {
        throw new AppError(
          "BIZ_RECONCILIATION_RUN_CONFLICT",
          "执行批次已取消或状态已变化，结果未写入"
        );
      }

      await tx
        .delete(checkDiff)
        .where(and(eq(checkDiff.tenantId, config.TENANT_ID), eq(checkDiff.runId, runId)));
      await tx
        .delete(checkMetricResult)
        .where(
          and(
            eq(checkMetricResult.tenantId, config.TENANT_ID),
            eq(checkMetricResult.runId, runId)
          )
        );

      if (result.metrics.length > 0) {
        await tx.insert(checkMetricResult).values(
          result.metrics.map((metric) => ({
            id: ulid(),
            tenantId: config.TENANT_ID,
            runId,
            comparisonCode: metric.comparisonCode,
            metricCode: metric.metricCode,
            metricName: metric.metricName,
            metricType: metric.metricType,
            checkResult: metric.checkResult,
            totalCount: metric.totalCount,
            failCount: metric.failCount,
            detailExt: null,
            createdBy: actor
          }))
        );
      }

      const chunkSize = 500;
      for (let index = 0; index < result.diffs.length; index += chunkSize) {
        const chunk = result.diffs.slice(index, index + chunkSize);
        await tx.insert(checkDiff).values(
          chunk.map((diff) => ({
            id: ulid(),
            tenantId: config.TENANT_ID,
            runId,
            comparisonCode: diff.comparisonCode,
            metricCode: diff.metricCode,
            diffType: diff.diffType,
            businessKeyText: truncate(diff.businessKeyText, 512),
            businessKeyExt: diff.businessKey,
            fieldCode: diff.fieldCode,
            leftValue: diff.leftValue,
            rightValue: diff.rightValue,
            diffValue: diff.diffValue,
            leftText: diff.leftText === null ? null : truncate(diff.leftText, 512),
            rightText: diff.rightText === null ? null : truncate(diff.rightText, 512),
            currency: diff.currency,
            diffStatus: "OPEN",
            version: 1,
            createdBy: actor,
            updatedBy: actor
          }))
        );
      }

    });

    try {
      await refreshGateForStage(
        (await getPackById(run.packId)).checkStage as "INTERFACE" | "PRE_BOOKING" | "POST_BOOKING",
        run.periodStartDate,
        run.periodEndDate,
        actor,
        { environmentId: run.environmentId, pairId: run.pairId }
      );
    } catch (error) {
      logger.warn({
        event: "gate.refresh.failed",
        runId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    logger.info({
      event: "run.execute.succeeded",
      runId,
      metricTotal: result.metrics.length,
      failMetricCount,
      diffCount: result.diffs.length
    });
    return getRunById(runId);
  } catch (error) {
    const current = await getRunById(runId);
    if (current.runStatus === "CANCELLED") {
      logger.warn({ event: "run.execute.cancelled", runId });
      return current;
    }
    const appError = error instanceof AppError ? error : undefined;
    await db
      .update(checkRun)
      .set({
        runStatus: "FAILED",
        failureCode: appError?.code ?? "BIZ_RECONCILIATION_SERVICE_INTERNAL",
        failureMessage: (error instanceof Error ? error.message : String(error)).slice(0, 512),
        finishedAt: sql`now()`,
        updatedBy: actor,
        updatedAt: sql`now()`
      })
      .where(and(eq(checkRun.tenantId, config.TENANT_ID), eq(checkRun.id, runId)));
    logger.error({
      event: "run.execute.failed",
      runId,
      error: error instanceof Error ? error.message : String(error)
    });
    return getRunById(runId);
  }
}

export interface CreateRunsForPairInput {
  pairId: string;
  environmentId?: string;
  periodStartDate: string;
  periodEndDate: string;
  runMode?: RunMode;
  actor: string;
  /** false 时同步执行完再返回；自动对账汇总依赖此行为 */
  defer?: boolean;
  /** 同一自动化执行内共享数据集抽取结果，避免重复读库 */
  extractionCache?: Map<string, Promise<ExtractDatasetResult>>;
}

export interface CreateRunsForPairResult {
  pairId: string;
  environmentId: string;
  created: Array<{
    packId: string;
    packCode: string;
    packName: string;
    runId: string;
    runNo: string;
    runStatus: string;
    reused: boolean;
  }>;
  skipped: Array<{
    packId: string;
    packCode: string;
    packName: string;
    reason: "INACTIVE" | "NO_PUBLISHED_VERSION" | "DATA_NOT_READY" | "NO_SOURCE_DATA";
  }>;
  failed: Array<{
    packId: string;
    packCode: string;
    packName: string;
    message: string;
  }>;
}

/** 按对账关系一次性为所有就绪的指标包创建执行批次。 */
export async function createRunsForPair(
  input: CreateRunsForPairInput
): Promise<CreateRunsForPairResult> {
  const readiness = await getPairReadiness(input);
  const created: CreateRunsForPairResult["created"] = [];
  const skipped: CreateRunsForPairResult["skipped"] = [];
  const failed: CreateRunsForPairResult["failed"] = [];
  const datasetByCode = new Map(
    readiness.datasets.map((dataset) => [dataset.datasetCode, dataset])
  );
  const extractionCache = input.extractionCache ?? new Map<string, Promise<ExtractDatasetResult>>();
  const outcomeCache = new Map<string, Promise<PackDatasetOutcome>>();

  function resolveOutcome(datasetCode: string): Promise<PackDatasetOutcome> {
    const cached = outcomeCache.get(datasetCode);
    if (cached !== undefined) {
      return cached;
    }
    const promise = loadDatasetOutcome(datasetCode);
    outcomeCache.set(datasetCode, promise);
    return promise;
  }

  async function loadDatasetOutcome(
    datasetCode: string
  ): Promise<PackDatasetOutcome> {
    const dataset = datasetByCode.get(datasetCode);
    if (dataset === undefined) {
      return {
        datasetCode,
        transport: "FILE",
        batchIds: [],
        loaded: 0,
        rejected: 0,
        errorMessage: `数据集 ${datasetCode} 未登记`
      };
    }
    if (dataset.dataSource === "DIRECT") {
      if (dataset.status !== "READY" && dataset.status !== "PARTIAL") {
        return {
          datasetCode,
          transport: "READONLY_SQL",
          batchIds: [],
          loaded: 0,
          rejected: 0,
          errorMessage: dataset.datasourceError ?? "源库未配置"
        };
      }
      const cacheKey = [
        datasetCode,
        readiness.environmentId,
        input.periodStartDate,
        input.periodEndDate
      ].join("|");
      let pending = extractionCache.get(cacheKey);
      if (pending === undefined) {
        pending = extractDatasetDirect({
          datasetCode,
          environmentId: readiness.environmentId,
          periodStartDate: input.periodStartDate,
          periodEndDate: input.periodEndDate,
          actor: input.actor
        });
        extractionCache.set(cacheKey, pending);
      }
      try {
        const result = await pending;
        return {
          datasetCode,
          transport: "READONLY_SQL",
          batchIds: [result.batchId],
          loaded: result.loaded,
          rejected: result.rejected
        };
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : `数据集 ${datasetCode} 读取源库失败`;
        logger.warn({
          event: "run.create_for_pair.extract_failed",
          pairId: input.pairId,
          datasetCode,
          error: error instanceof Error ? error.message : String(error)
        });
        return {
          datasetCode,
          transport: "READONLY_SQL",
          batchIds: [],
          loaded: 0,
          rejected: 0,
          errorMessage: message
        };
      }
    }

    // 文件数据集仍依赖已暂存的批次
    const stagedBatches = await db
      .select({
        batchId: stagingRecord.importBatchId,
        count: sql<number>`count(*)::int`
      })
      .from(stagingRecord)
      .where(
        and(
          eq(stagingRecord.tenantId, config.TENANT_ID),
          eq(stagingRecord.datasetCode, datasetCode),
          eq(stagingRecord.environmentId, readiness.environmentId),
          gte(stagingRecord.businessDate, input.periodStartDate),
          lte(stagingRecord.businessDate, input.periodEndDate),
          isNull(stagingRecord.deletedAt)
        )
      )
      .groupBy(stagingRecord.importBatchId);
    const batchIds = stagedBatches.map((row) => row.batchId).sort();
    const loaded = stagedBatches.reduce((sum, row) => sum + row.count, 0);
    let rejected = 0;
    if (batchIds.length > 0) {
      const rejectedRows = await db
        .select({ rejected: sql<number>`coalesce(sum(${importBatch.rowRejected}), 0)::int` })
        .from(importBatch)
        .where(
          and(
            eq(importBatch.tenantId, config.TENANT_ID),
            inArray(importBatch.id, batchIds),
            isNull(importBatch.deletedAt)
          )
        );
      rejected = rejectedRows[0]?.rejected ?? 0;
    }
    return { datasetCode, transport: "FILE", batchIds, loaded, rejected };
  }

  for (const pack of readiness.packs) {
    if (!pack.ready) {
      const blockingDataset = pack.blockingDatasetCodes
        .map((code) => datasetByCode.get(code))
        .find(
          (dataset) =>
            dataset !== undefined &&
            (dataset.status === "NO_DATASOURCE" ||
              dataset.status === "NO_EXTRACT" ||
              dataset.status === "NO_DATASET")
        );
      if (blockingDataset !== undefined) {
        // 配置问题不能伪装成“无数据”
        failed.push({
          packId: pack.packId,
          packCode: pack.packCode,
          packName: pack.packName,
          message: blockingDataset.datasourceError ?? "源库未配置"
        });
      } else {
        skipped.push({
          packId: pack.packId,
          packCode: pack.packCode,
          packName: pack.packName,
          reason: "DATA_NOT_READY"
        });
      }
      continue;
    }
    try {
      const outcomes = await Promise.all(
        pack.requiredDatasetCodes.map((code) => resolveOutcome(code))
      );
      const decision = decidePackExecution(outcomes);
      if (decision.action === "SKIP") {
        skipped.push({
          packId: pack.packId,
          packCode: pack.packCode,
          packName: pack.packName,
          reason: decision.reason
        });
        continue;
      }
      if (decision.action === "FAIL") {
        failed.push({
          packId: pack.packId,
          packCode: pack.packCode,
          packName: pack.packName,
          message: decision.message
        });
        continue;
      }
      const result = await createRun({
        packId: pack.packId,
        environmentId: readiness.environmentId,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        runMode: input.runMode ?? "FULL",
        actor: input.actor,
        defer: input.defer,
        batchIds: decision.batchIds
      });
      created.push({
        packId: pack.packId,
        packCode: pack.packCode,
        packName: pack.packName,
        runId: result.run.id,
        runNo: result.run.runNo,
        runStatus: result.run.runStatus,
        reused: !result.created
      });
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : "创建执行批次失败";
      logger.warn({
        event: "run.create_for_pair.pack_failed",
        pairId: input.pairId,
        packCode: pack.packCode,
        error: message
      });
      failed.push({
        packId: pack.packId,
        packCode: pack.packCode,
        packName: pack.packName,
        message
      });
    }
  }

  for (const pack of readiness.skippedPacks) {
    skipped.push({
      packId: pack.packId,
      packCode: pack.packCode,
      packName: pack.packName,
      reason: pack.reason
    });
  }

  logger.info({
    event: "run.create_for_pair",
    pairId: input.pairId,
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
    created: created.length,
    skipped: skipped.length,
    failed: failed.length
  });

  return {
    pairId: input.pairId,
    environmentId: readiness.environmentId,
    created,
    skipped,
    failed
  };
}

export async function listRuns(
  options: {
    limit?: number;
    environmentId?: string;
    pairId?: string;
    packId?: string;
    periodStartDate?: string;
    periodEndDate?: string;
  } = {}
) {
  const conditions = [
    eq(checkRun.tenantId, config.TENANT_ID),
    isNull(checkRun.deletedAt)
  ];
  if (options.environmentId !== undefined && options.environmentId !== "") {
    conditions.push(eq(checkRun.environmentId, options.environmentId));
  }
  if (options.pairId !== undefined && options.pairId !== "") {
    conditions.push(eq(checkRun.pairId, options.pairId));
  }
  if (options.packId !== undefined && options.packId !== "") {
    conditions.push(eq(checkRun.packId, options.packId));
  }
  if (options.periodStartDate !== undefined && options.periodStartDate !== "") {
    conditions.push(gte(checkRun.periodStartDate, options.periodStartDate));
  }
  if (options.periodEndDate !== undefined && options.periodEndDate !== "") {
    conditions.push(lte(checkRun.periodEndDate, options.periodEndDate));
  }
  return db
    .select({
      run: checkRun,
      packCode: checkPack.packCode,
      packName: checkPack.packName,
      pairId: checkPack.pairId
    })
    .from(checkRun)
    .innerJoin(checkPack, eq(checkRun.packId, checkPack.id))
    .where(and(...conditions))
    .orderBy(desc(checkRun.createdAt))
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
}

export async function getRunSummary(runId: string) {
  const run = await getRunById(runId);
  const pack = await getPackById(run.packId);
  const version = await getPackVersionById(run.packVersionId);
  const metrics = await db
    .select()
    .from(checkMetricResult)
    .where(
      and(
        eq(checkMetricResult.tenantId, config.TENANT_ID),
        eq(checkMetricResult.runId, runId)
      )
    )
    .orderBy(asc(checkMetricResult.comparisonCode), asc(checkMetricResult.metricCode));
  return { run, pack, version, metrics };
}

export async function getRunDiffs(
  runId: string,
  options: { metricCode?: string; status?: string; limit?: number } = {}
) {
  await getRunById(runId);
  const conditions = [
    eq(checkDiff.tenantId, config.TENANT_ID),
    eq(checkDiff.runId, runId),
    isNull(checkDiff.deletedAt)
  ];
  if (options.metricCode !== undefined) {
    conditions.push(eq(checkDiff.metricCode, options.metricCode));
  }
  if (options.status !== undefined) {
    conditions.push(eq(checkDiff.diffStatus, options.status));
  }
  return db
    .select()
    .from(checkDiff)
    .where(and(...conditions))
    .orderBy(asc(checkDiff.metricCode), asc(checkDiff.businessKeyText), asc(checkDiff.fieldCode))
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 1000));
}

export async function cancelRun(runId: string, actor: string) {
  const run = await getRunById(runId);
  assertTransition("RUN", run.runStatus, "CANCELLED");
  const [updated] = await db
    .update(checkRun)
    .set({
      runStatus: "CANCELLED",
      finishedAt: sql`now()`,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(and(eq(checkRun.tenantId, config.TENANT_ID), eq(checkRun.id, runId)))
    .returning();
  return requireRow(updated, "执行批次取消失败");
}

/**
 * 进程重启后回收残留 RUNNING 批次。
 * 否则其幂等指纹会永久命中，后续同期间批次无法重新执行。
 */
export async function recoverStaleCheckRuns(): Promise<number> {
  const rows = await db
    .update(checkRun)
    .set({
      runStatus: "FAILED",
      failureCode: "BIZ_RECONCILIATION_RUN_UNAVAILABLE",
      failureMessage: "服务重启，运行中的执行批次已标记失败",
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedBy: "agent:startup"
    })
    .where(
      and(
        eq(checkRun.tenantId, config.TENANT_ID),
        eq(checkRun.runStatus, "RUNNING")
      )
    )
    .returning({ id: checkRun.id });
  if (rows.length > 0) {
    logger.warn({ event: "run.recovered_stale", count: rows.length });
  }
  return rows.length;
}

export async function replayRun(runId: string, actor: string) {
  const run = await getRunById(runId);
  const manifest = manifestSchema.parse(run.inputManifestExt);
  return createRun({
    packId: run.packId,
    environmentId: run.environmentId ?? undefined,
    periodStartDate: run.periodStartDate,
    periodEndDate: run.periodEndDate,
    runMode: run.runMode as RunMode,
    toleranceOverride: manifest.toleranceOverride,
    actor,
    defer: false,
    // 重放固定使用原执行批次引用的源数据，避免后续抽取改变结果
    batchIds: manifest.batchIds
  });
}

export async function listPacksForStage(packId: string) {
  const rows = await db
    .select()
    .from(checkPackVersion)
    .where(
      and(
        eq(checkPackVersion.tenantId, config.TENANT_ID),
        eq(checkPackVersion.packId, packId),
        isNull(checkPackVersion.deletedAt)
      )
    )
    .orderBy(desc(checkPackVersion.versionNo));
  return rows;
}
