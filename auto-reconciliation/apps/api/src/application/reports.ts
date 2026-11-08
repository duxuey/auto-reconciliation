import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { daysSince } from "@infra/biz-reconciliation-engine";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  checkDiff,
  checkMetricResult,
  checkPack,
  checkRun
} from "../db/schema.js";
import { listPacks } from "./catalog.js";
import { getGate } from "./gates.js";

export interface OverviewPack {
  packId: string;
  packCode: string;
  packName: string;
  checkStage: string;
  packStatus: string;
  latestRun: {
    id: string;
    runNo: string;
    runStatus: string;
    periodStartDate: string;
    periodEndDate: string;
    metricTotal: number;
    failMetricCount: number;
    createdAt: string;
  } | null;
  openDiffCount: number;
}

export async function getOverview(
  options: { environmentId?: string; pairId?: string } = {}
): Promise<{
  environmentId: string | null;
  pairId: string | null;
  packs: OverviewPack[];
  totalOpenDiffs: number;
}> {
  const packs = await listPacks(options.pairId);
  const result: OverviewPack[] = [];
  let totalOpenDiffs = 0;

  for (const pack of packs) {
    const runConditions = [
      eq(checkRun.tenantId, config.TENANT_ID),
      eq(checkRun.packId, pack.id),
      isNull(checkRun.deletedAt)
    ];
    if (options.environmentId !== undefined && options.environmentId !== "") {
      runConditions.push(eq(checkRun.environmentId, options.environmentId));
    }
    if (options.pairId !== undefined && options.pairId !== "") {
      runConditions.push(eq(checkRun.pairId, options.pairId));
    }
    const runs = await db
      .select()
      .from(checkRun)
      .where(and(...runConditions))
      .orderBy(desc(checkRun.createdAt))
      .limit(1);
    const run = runs[0];
    let openDiffCount = 0;
    if (run !== undefined) {
      const diffs = await db
        .select({ id: checkDiff.id })
        .from(checkDiff)
        .where(
          and(
            eq(checkDiff.tenantId, config.TENANT_ID),
            eq(checkDiff.runId, run.id),
            inArray(checkDiff.diffStatus, ["OPEN", "ASSIGNED", "INVESTIGATING"]),
            isNull(checkDiff.deletedAt)
          )
        );
      openDiffCount = diffs.length;
      totalOpenDiffs += openDiffCount;
    }
    result.push({
      packId: pack.id,
      packCode: pack.packCode,
      packName: pack.packName,
      checkStage: pack.checkStage,
      packStatus: pack.packStatus,
      latestRun:
        run === undefined
          ? null
          : {
              id: run.id,
              runNo: run.runNo,
              runStatus: run.runStatus,
              periodStartDate: run.periodStartDate,
              periodEndDate: run.periodEndDate,
              metricTotal: run.metricTotal,
              failMetricCount: run.failMetricCount,
              createdAt: run.createdAt.toISOString()
            },
      openDiffCount
    });
  }
  return {
    environmentId: options.environmentId ?? null,
    pairId: options.pairId ?? null,
    packs: result,
    totalOpenDiffs
  };
}

export async function getMetricsReport(options: {
  packId?: string;
  environmentId?: string;
  pairId?: string;
  periodStartDate?: string;
  periodEndDate?: string;
}) {
  const conditions = [
    eq(checkMetricResult.tenantId, config.TENANT_ID),
    isNull(checkRun.deletedAt)
  ];
  if (options.packId !== undefined) {
    conditions.push(eq(checkRun.packId, options.packId));
  }
  if (options.environmentId !== undefined && options.environmentId !== "") {
    conditions.push(eq(checkRun.environmentId, options.environmentId));
  }
  if (options.pairId !== undefined && options.pairId !== "") {
    conditions.push(eq(checkRun.pairId, options.pairId));
  }
  if (options.periodStartDate !== undefined) {
    conditions.push(gte(checkRun.periodStartDate, options.periodStartDate));
  }
  if (options.periodEndDate !== undefined) {
    conditions.push(lte(checkRun.periodEndDate, options.periodEndDate));
  }
  return db
    .select({
      packCode: checkPack.packCode,
      packName: checkPack.packName,
      runId: checkRun.id,
      runNo: checkRun.runNo,
      periodStartDate: checkRun.periodStartDate,
      periodEndDate: checkRun.periodEndDate,
      metricCode: checkMetricResult.metricCode,
      metricName: checkMetricResult.metricName,
      metricType: checkMetricResult.metricType,
      checkResult: checkMetricResult.checkResult,
      totalCount: checkMetricResult.totalCount,
      failCount: checkMetricResult.failCount
    })
    .from(checkMetricResult)
    .innerJoin(checkRun, eq(checkMetricResult.runId, checkRun.id))
    .innerJoin(checkPack, eq(checkRun.packId, checkPack.id))
    .where(and(...conditions))
    .orderBy(
      desc(checkRun.createdAt),
      checkMetricResult.comparisonCode,
      checkMetricResult.metricCode
    )
    .limit(500);
}

export async function getDiffAging(
  options: { environmentId?: string; pairId?: string } = {}
) {
  const conditions = [
    eq(checkDiff.tenantId, config.TENANT_ID),
    inArray(checkDiff.diffStatus, ["OPEN", "ASSIGNED", "INVESTIGATING"]),
    isNull(checkDiff.deletedAt)
  ];
  if (options.environmentId !== undefined && options.environmentId !== "") {
    conditions.push(eq(checkRun.environmentId, options.environmentId));
  }
  if (options.pairId !== undefined && options.pairId !== "") {
    conditions.push(eq(checkRun.pairId, options.pairId));
  }
  const diffs = await db
    .select({ status: checkDiff.diffStatus, createdAt: checkDiff.createdAt })
    .from(checkDiff)
    .innerJoin(checkRun, eq(checkDiff.runId, checkRun.id))
    .where(and(...conditions));
  const buckets = [
    { label: "0-3天", min: 0, max: 3, count: 0 },
    { label: "4-7天", min: 4, max: 7, count: 0 },
    { label: "8-30天", min: 8, max: 30, count: 0 },
    { label: "31天以上", min: 31, max: Number.MAX_SAFE_INTEGER, count: 0 }
  ];
  for (const diff of diffs) {
    const age = daysSince(diff.createdAt.toISOString());
    const bucket = buckets.find((item) => age >= item.min && age <= item.max);
    if (bucket !== undefined) {
      bucket.count += 1;
    }
  }
  return { total: diffs.length, buckets };
}

export async function getFinanceScopeReport(
  periodStartDate: string,
  periodEndDate: string,
  options: { environmentId?: string; pairId?: string } = {}
) {
  let gate = null;
  try {
    gate = await getGate("POST_BOOKING", periodStartDate, periodEndDate, options);
  } catch {
    gate = null;
  }
  const metrics = await getMetricsReport({ ...options, periodStartDate, periodEndDate });
  const diffs = await db
    .select()
    .from(checkDiff)
    .where(
      and(
        eq(checkDiff.tenantId, config.TENANT_ID),
        inArray(checkDiff.diffStatus, ["OPEN", "ASSIGNED", "INVESTIGATING"]),
        isNull(checkDiff.deletedAt)
      )
    )
    .orderBy(checkDiff.metricCode, checkDiff.businessKeyText)
    .limit(500);
  return {
    stage: "POST_BOOKING",
    gate,
    metrics,
    diffs
  };
}
