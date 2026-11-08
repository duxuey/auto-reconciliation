import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { normalizeMoney, parsePackConfig } from "@infra/biz-reconciliation-engine";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  adjustment,
  checkDiff,
  checkDiffLog,
  checkPackVersion,
  checkRun,
  stagingRecord
} from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import { assertTransition } from "../domain/status.js";
import { requireRow } from "../infra/require.js";
import { getPackVersionById } from "./catalog.js";
import { getRunById } from "./runs.js";

export interface DiffFilters {
  runId?: string;
  pairId?: string;
  environmentId?: string;
  metricCode?: string;
  status?: string;
  businessKey?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  limit?: number;
}

export interface AdjustmentListFilters {
  status?: string;
  pairId?: string;
  environmentId?: string;
}

function runScopeFilter(filters: {
  pairId?: string;
  environmentId?: string;
  periodStartDate?: string;
  periodEndDate?: string;
}) {
  const conditions = [
    eq(checkRun.tenantId, config.TENANT_ID),
    isNull(checkRun.deletedAt)
  ];
  if (filters.pairId !== undefined && filters.pairId !== "") {
    conditions.push(eq(checkRun.pairId, filters.pairId));
  }
  if (filters.environmentId !== undefined && filters.environmentId !== "") {
    conditions.push(eq(checkRun.environmentId, filters.environmentId));
  }
  if (filters.periodStartDate !== undefined && filters.periodStartDate !== "") {
    conditions.push(gte(checkRun.periodStartDate, filters.periodStartDate));
  }
  if (filters.periodEndDate !== undefined && filters.periodEndDate !== "") {
    conditions.push(lte(checkRun.periodEndDate, filters.periodEndDate));
  }
  return conditions.length > 2
    ? db.select({ id: checkRun.id }).from(checkRun).where(and(...conditions))
    : undefined;
}

async function findDiff(id: string) {
  const rows = await db
    .select()
    .from(checkDiff)
    .where(
      and(
        eq(checkDiff.tenantId, config.TENANT_ID),
        eq(checkDiff.id, id),
        isNull(checkDiff.deletedAt)
      )
    )
    .limit(1);
  const diff = rows[0];
  if (diff === undefined) {
    throw new AppError("BIZ_RECONCILIATION_DIFF_NOT_FOUND", `差异 ${id} 不存在`);
  }
  return diff;
}

export async function listDiffs(filters: DiffFilters) {
  const conditions = [
    eq(checkDiff.tenantId, config.TENANT_ID),
    isNull(checkDiff.deletedAt)
  ];
  if (filters.runId !== undefined) {
    conditions.push(eq(checkDiff.runId, filters.runId));
  }
  if (filters.metricCode !== undefined) {
    conditions.push(eq(checkDiff.metricCode, filters.metricCode));
  }
  if (filters.status !== undefined) {
    conditions.push(eq(checkDiff.diffStatus, filters.status));
  }
  if (filters.businessKey !== undefined && filters.businessKey !== "") {
    conditions.push(ilike(checkDiff.businessKeyText, `%${filters.businessKey}%`));
  }
  const runScope = runScopeFilter(filters);
  if (runScope !== undefined) {
    conditions.push(inArray(checkDiff.runId, runScope));
  }
  return db
    .select()
    .from(checkDiff)
    .where(and(...conditions))
    .orderBy(desc(checkDiff.createdAt), asc(checkDiff.metricCode))
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500));
}

export async function getDiffById(id: string) {
  const diff = await findDiff(id);
  const logs = await db
    .select()
    .from(checkDiffLog)
    .where(
      and(
        eq(checkDiffLog.tenantId, config.TENANT_ID),
        eq(checkDiffLog.diffId, id)
      )
    )
    .orderBy(desc(checkDiffLog.createdAt));

  const run = await getRunById(diff.runId);
  const version = await getPackVersionById(run.packVersionId);
  const packConfig = parsePackConfig(version.configJson);
  const manifest = z
    .object({ batchIds: z.array(z.string()).optional() })
    .passthrough()
    .safeParse(run.inputManifestExt);
  const runBatchIds = manifest.success ? (manifest.data.batchIds ?? []) : [];
  const datasetCodes = new Set<string>();
  for (const comparison of packConfig.comparisons) {
    for (const dataset of [comparison.leftDataset, comparison.rightDataset]) {
      if (Array.isArray(dataset)) {
        dataset.forEach((code) => datasetCodes.add(code));
      } else {
        datasetCodes.add(dataset);
      }
    }
  }

  const sourceRows =
    datasetCodes.size === 0
      ? []
      : await db
          .select()
          .from(stagingRecord)
          .where(
            and(
              eq(stagingRecord.tenantId, config.TENANT_ID),
              inArray(stagingRecord.datasetCode, [...datasetCodes]),
              eq(stagingRecord.businessKeyText, diff.businessKeyText),
              // 只钻取本次执行实际使用的批次，避免后续导入污染历史差异
              runBatchIds.length === 0
                ? sql`true`
                : inArray(stagingRecord.importBatchId, runBatchIds),
              isNull(stagingRecord.deletedAt)
            )
          )
          .orderBy(stagingRecord.datasetCode, stagingRecord.externalId);

  return { diff, logs, sourceRows };
}

interface TransitionOptions {
  expectedVersion?: number;
  note?: string;
  resolutionType?: string;
  assignee?: string;
}

async function transition(
  id: string,
  toStatus: string,
  action: string,
  actor: string,
  options: TransitionOptions = {}
) {
  const diff = await findDiff(id);
  if (options.expectedVersion !== undefined && diff.version !== options.expectedVersion) {
    throw new AppError(
      "BIZ_RECONCILIATION_DIFF_CONFLICT",
      `差异版本已变化（期望 ${options.expectedVersion}，实际 ${diff.version}）`
    );
  }
  assertTransition("DIFF", diff.diffStatus, toStatus);
  const [updated] = await db
    .update(checkDiff)
    .set({
      diffStatus: toStatus,
      assignee: options.assignee ?? diff.assignee,
      resolutionType: options.resolutionType ?? diff.resolutionType,
      resolutionNote: options.note ?? diff.resolutionNote,
      version: diff.version + 1,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(and(eq(checkDiff.tenantId, config.TENANT_ID), eq(checkDiff.id, id)))
    .returning();
  const result = requireRow(updated, "差异状态更新失败");
  await db.insert(checkDiffLog).values({
    id: ulid(),
    tenantId: config.TENANT_ID,
    diffId: id,
    action,
    fromStatus: diff.diffStatus,
    toStatus,
    note: options.note ?? null,
    actor,
    createdBy: actor
  });
  return result;
}

export async function assignDiff(
  id: string,
  assignee: string,
  actor: string,
  options: TransitionOptions = {}
) {
  return transition(id, "ASSIGNED", "ASSIGNED", actor, { ...options, assignee });
}

export async function investigateDiff(
  id: string,
  actor: string,
  options: TransitionOptions = {}
) {
  return transition(id, "INVESTIGATING", "INVESTIGATING", actor, options);
}

export async function resolveDiff(
  id: string,
  actor: string,
  input: { resolutionType: string; note: string; expectedVersion?: number }
) {
  return transition(id, "RESOLVED", "RESOLVED", actor, {
    expectedVersion: input.expectedVersion,
    note: input.note,
    resolutionType: input.resolutionType
  });
}

export async function writeOffDiff(
  id: string,
  actor: string,
  input: { note: string; confirm: boolean; expectedVersion?: number }
) {
  if (!input.confirm) {
    throw new AppError(
      "BIZ_RECONCILIATION_DIFF_CONFLICT",
      "L3 核销必须显式 confirm=true"
    );
  }
  return transition(id, "WRITTEN_OFF", "WRITTEN_OFF", actor, {
    expectedVersion: input.expectedVersion,
    note: input.note,
    resolutionType: "WRITE_OFF"
  });
}

export async function reopenDiff(
  id: string,
  actor: string,
  input: { note: string; expectedVersion?: number }
) {
  return transition(id, "OPEN", "REOPENED", actor, {
    expectedVersion: input.expectedVersion,
    note: input.note
  });
}

export async function commentDiff(id: string, actor: string, note: string) {
  const diff = await findDiff(id);
  await db.insert(checkDiffLog).values({
    id: ulid(),
    tenantId: config.TENANT_ID,
    diffId: id,
    action: "COMMENT",
    fromStatus: diff.diffStatus,
    toStatus: diff.diffStatus,
    note,
    actor,
    createdBy: actor
  });
  return { diffId: id, commented: true };
}

export interface CreateAdjustmentInput {
  adjustmentType: string;
  amount: string;
  currency: string;
  reason: string;
}

export async function createAdjustment(
  diffId: string,
  input: CreateAdjustmentInput,
  actor: string
) {
  const diff = await findDiff(diffId);
  const amount = normalizeMoney(input.amount);
  const [created] = await db
    .insert(adjustment)
    .values({
      id: ulid(),
      tenantId: config.TENANT_ID,
      diffId,
      runId: diff.runId,
      adjustmentNo: `ADJ${diff.runId.slice(-8)}${ulid().slice(-6)}`,
      adjustmentType: input.adjustmentType,
      amount,
      currency: input.currency.toUpperCase(),
      reason: input.reason,
      adjustmentStatus: "DRAFT",
      version: 1,
      createdBy: actor,
      updatedBy: actor
    })
    .returning();
  const record = requireRow(created, "调整建议创建失败");
  await db.insert(checkDiffLog).values({
    id: ulid(),
    tenantId: config.TENANT_ID,
    diffId,
    action: "ADJUSTMENT_CREATED",
    fromStatus: diff.diffStatus,
    toStatus: diff.diffStatus,
    note: input.reason,
    actor,
    createdBy: actor
  });
  return record;
}

export async function listAdjustments(filters: AdjustmentListFilters = {}) {
  const conditions = [
    eq(adjustment.tenantId, config.TENANT_ID),
    isNull(adjustment.deletedAt)
  ];
  if (filters.status !== undefined) {
    conditions.push(eq(adjustment.adjustmentStatus, filters.status));
  }
  const runScope = runScopeFilter(filters);
  if (runScope !== undefined) {
    conditions.push(inArray(adjustment.runId, runScope));
  }
  return db
    .select({
      id: adjustment.id,
      tenantId: adjustment.tenantId,
      diffId: adjustment.diffId,
      runId: adjustment.runId,
      adjustmentNo: adjustment.adjustmentNo,
      adjustmentType: adjustment.adjustmentType,
      amount: adjustment.amount,
      currency: adjustment.currency,
      reason: adjustment.reason,
      adjustmentStatus: adjustment.adjustmentStatus,
      version: adjustment.version,
      createdAt: adjustment.createdAt,
      createdBy: adjustment.createdBy,
      updatedAt: adjustment.updatedAt,
      updatedBy: adjustment.updatedBy,
      deletedAt: adjustment.deletedAt,
      businessKeyText: checkDiff.businessKeyText,
      metricCode: checkDiff.metricCode
    })
    .from(adjustment)
    .leftJoin(
      checkDiff,
      and(
        eq(checkDiff.id, adjustment.diffId),
        eq(checkDiff.tenantId, config.TENANT_ID)
      )
    )
    .where(and(...conditions))
    .orderBy(desc(adjustment.createdAt))
    .limit(200);
}

async function findAdjustment(id: string) {
  const rows = await db
    .select()
    .from(adjustment)
    .where(
      and(
        eq(adjustment.tenantId, config.TENANT_ID),
        eq(adjustment.id, id),
        isNull(adjustment.deletedAt)
      )
    )
    .limit(1);
  const record = rows[0];
  if (record === undefined) {
    throw new AppError("BIZ_RECONCILIATION_ADJUSTMENT_NOT_FOUND", `调整建议 ${id} 不存在`);
  }
  return record;
}

async function transitionAdjustment(
  id: string,
  toStatus: string,
  actor: string,
  expectedVersion?: number
) {
  const record = await findAdjustment(id);
  if (expectedVersion !== undefined && record.version !== expectedVersion) {
    throw new AppError(
      "BIZ_RECONCILIATION_ADJUSTMENT_CONFLICT",
      `调整建议版本已变化（期望 ${expectedVersion}，实际 ${record.version}）`
    );
  }
  assertTransition("ADJUSTMENT", record.adjustmentStatus, toStatus);
  const [updated] = await db
    .update(adjustment)
    .set({
      adjustmentStatus: toStatus,
      version: record.version + 1,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(and(eq(adjustment.tenantId, config.TENANT_ID), eq(adjustment.id, id)))
    .returning();
  return requireRow(updated, "调整建议状态更新失败");
}

export async function submitAdjustment(id: string, actor: string) {
  return transitionAdjustment(id, "SUBMITTED", actor);
}

export async function approveAdjustment(
  id: string,
  actor: string,
  input: { confirm: boolean }
) {
  if (!input.confirm) {
    throw new AppError(
      "BIZ_RECONCILIATION_ADJUSTMENT_CONFLICT",
      "L3 审批必须显式 confirm=true"
    );
  }
  return transitionAdjustment(id, "APPROVED", actor);
}

export async function rejectAdjustment(id: string, actor: string) {
  return transitionAdjustment(id, "REJECTED", actor);
}

export async function getAdjustmentById(id: string) {
  return findAdjustment(id);
}

export async function getAdjustmentsByIds(ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select()
    .from(adjustment)
    .where(
      and(
        eq(adjustment.tenantId, config.TENANT_ID),
        inArray(adjustment.id, ids),
        isNull(adjustment.deletedAt)
      )
    )
    .orderBy(asc(adjustment.adjustmentNo));
}

export async function getRunMetricResults(runId: string) {
  return db
    .select()
    .from(checkRun)
    .where(and(eq(checkRun.tenantId, config.TENANT_ID), eq(checkRun.id, runId)))
    .limit(1);
}

export async function listVersionForPack(packId: string) {
  return db
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
}
