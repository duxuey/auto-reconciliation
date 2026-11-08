import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  checkGate,
  checkMetricResult,
  checkPack,
  checkRun
} from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import type { CheckStage } from "@infra/biz-reconciliation-engine";
import { assertTransition } from "../domain/status.js";

export interface BlockingMetric {
  packCode: string;
  metricCode: string;
  metricName: string;
  failCount: number;
}

export interface GateScope {
  environmentId?: string | null;
  pairId?: string | null;
}

export interface GateSnapshot {
  id: string;
  checkStage: CheckStage;
  environmentId: string | null;
  pairId: string | null;
  periodStartDate: string;
  periodEndDate: string;
  gateStatus: string;
  runIds: string[];
  blockingMetrics: BlockingMetric[];
  signedOffAt: string | null;
  signedOffBy: string | null;
  version: number;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new AppError("BIZ_RECONCILIATION_GATE_NOT_FOUND", message);
  }
  return row;
}

function toSnapshot(row: typeof checkGate.$inferSelect): GateSnapshot {
  return {
    id: row.id,
    checkStage: row.checkStage as CheckStage,
    environmentId: row.environmentId,
    pairId: row.pairId,
    periodStartDate: row.periodStartDate,
    periodEndDate: row.periodEndDate,
    gateStatus: row.gateStatus,
    runIds: row.runIdsExt,
    blockingMetrics: row.blockingMetricsExt,
    signedOffAt: row.signedOffAt?.toISOString() ?? null,
    signedOffBy: row.signedOffBy,
    version: row.version
  };
}

async function findGate(
  stage: CheckStage,
  periodStartDate: string,
  periodEndDate: string,
  scope: GateScope = {}
) {
  const conditions = [
    eq(checkGate.tenantId, config.TENANT_ID),
    eq(checkGate.checkStage, stage),
    eq(checkGate.periodStartDate, periodStartDate),
    eq(checkGate.periodEndDate, periodEndDate),
    isNull(checkGate.deletedAt)
  ];
  if (scope.environmentId !== undefined && scope.environmentId !== null) {
    conditions.push(eq(checkGate.environmentId, scope.environmentId));
  }
  if (scope.pairId !== undefined && scope.pairId !== null) {
    conditions.push(eq(checkGate.pairId, scope.pairId));
  }
  const rows = await db
    .select()
    .from(checkGate)
    .where(and(...conditions))
    .orderBy(desc(checkGate.createdAt))
    .limit(1);
  return rows[0];
}

export async function getGate(
  stage: CheckStage,
  periodStartDate: string,
  periodEndDate: string,
  scope: GateScope = {}
): Promise<GateSnapshot> {
  const row = await findGate(stage, periodStartDate, periodEndDate, scope);
  if (row === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_GATE_NOT_FOUND",
      `阶段 ${stage} 在 ${periodStartDate} ~ ${periodEndDate} 尚未生成闸门`
    );
  }
  return toSnapshot(row);
}

/**
 * 根据各指标包最新一次成功执行刷新闸门。
 * 任一包未执行或存在失败指标 → BLOCKED；已签核后再次失败 → 回到 BLOCKED。
 */
export async function refreshGateForStage(
  stage: CheckStage,
  periodStartDate: string,
  periodEndDate: string,
  actor: string,
  scope: GateScope = {}
): Promise<GateSnapshot> {
  const packConditions = [
    eq(checkPack.tenantId, config.TENANT_ID),
    eq(checkPack.checkStage, stage),
    eq(checkPack.packStatus, "ACTIVE"),
    isNull(checkPack.deletedAt)
  ];
  if (scope.pairId !== undefined && scope.pairId !== null) {
    packConditions.push(eq(checkPack.pairId, scope.pairId));
  }
  const packs = await db
    .select()
    .from(checkPack)
    .where(and(...packConditions))
    .orderBy(checkPack.packCode);

  const runIds: string[] = [];
  const blocking: BlockingMetric[] = [];

  for (const pack of packs) {
    const runConditions = [
      eq(checkRun.tenantId, config.TENANT_ID),
      eq(checkRun.packId, pack.id),
      eq(checkRun.runStatus, "SUCCEEDED"),
      eq(checkRun.periodStartDate, periodStartDate),
      eq(checkRun.periodEndDate, periodEndDate),
      isNull(checkRun.deletedAt)
    ];
    if (scope.environmentId !== undefined && scope.environmentId !== null) {
      runConditions.push(eq(checkRun.environmentId, scope.environmentId));
    }
    if (scope.pairId !== undefined && scope.pairId !== null) {
      runConditions.push(eq(checkRun.pairId, scope.pairId));
    }
    const runs = await db
      .select()
      .from(checkRun)
      .where(and(...runConditions))
      .orderBy(desc(checkRun.createdAt))
      .limit(1);
    const run = runs[0];
    if (run === undefined) {
      blocking.push({
        packCode: pack.packCode,
        metricCode: "NO_RUN",
        metricName: "期间内无成功执行",
        failCount: 0
      });
      continue;
    }
    runIds.push(run.id);
    const failures = await db
      .select()
      .from(checkMetricResult)
      .where(
        and(
          eq(checkMetricResult.tenantId, config.TENANT_ID),
          eq(checkMetricResult.runId, run.id),
          eq(checkMetricResult.checkResult, "FAIL")
        )
      )
      .orderBy(checkMetricResult.metricCode);
    for (const failure of failures) {
      blocking.push({
        packCode: pack.packCode,
        metricCode: failure.metricCode,
        metricName: failure.metricName,
        failCount: failure.failCount
      });
    }
  }

  const existing = await findGate(stage, periodStartDate, periodEndDate, scope);
  const computedStatus = blocking.length === 0 ? "PASSED" : "BLOCKED";
  const finalStatus =
    existing?.gateStatus === "SIGNED_OFF" && computedStatus === "PASSED"
      ? "SIGNED_OFF"
      : computedStatus;

  if (existing === undefined) {
    const [created] = await db
      .insert(checkGate)
      .values({
        id: ulid(),
        tenantId: config.TENANT_ID,
        checkStage: stage,
        environmentId: scope.environmentId ?? null,
        pairId: scope.pairId ?? null,
        periodStartDate,
        periodEndDate,
        gateStatus: finalStatus,
        runIdsExt: runIds,
        blockingMetricsExt: blocking,
        signedOffAt: null,
        signedOffBy: null,
        version: 1,
        createdBy: actor,
        updatedBy: actor
      })
      .returning();
    return toSnapshot(requireRow(created, "闸门创建失败"));
  }

  if (existing.gateStatus !== finalStatus) {
    assertTransition("GATE", existing.gateStatus, finalStatus);
  }
  const [updated] = await db
    .update(checkGate)
    .set({
      gateStatus: finalStatus,
      runIdsExt: runIds,
      blockingMetricsExt: blocking,
      version: existing.version + 1,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(
      and(eq(checkGate.tenantId, config.TENANT_ID), eq(checkGate.id, existing.id))
    )
    .returning();
  return toSnapshot(requireRow(updated, "闸门更新失败"));
}

export async function signOffGate(
  stage: CheckStage,
  periodStartDate: string,
  periodEndDate: string,
  options: { dryRun: boolean; confirm: boolean },
  actor: string,
  scope: GateScope = {}
): Promise<GateSnapshot> {
  const current = await getGate(stage, periodStartDate, periodEndDate, scope);
  if (current.gateStatus !== "PASSED") {
    throw new AppError(
      "BIZ_RECONCILIATION_GATE_CONFLICT",
      `闸门当前状态为 ${current.gateStatus}，仅 PASSED 可签核`
    );
  }
  if (options.dryRun) {
    return current;
  }
  if (!options.confirm) {
    throw new AppError(
      "BIZ_RECONCILIATION_GATE_CONFLICT",
      "L3 签核必须显式 confirm=true"
    );
  }
  assertTransition("GATE", current.gateStatus, "SIGNED_OFF");
  const [updated] = await db
    .update(checkGate)
    .set({
      gateStatus: "SIGNED_OFF",
      signedOffAt: sql`now()`,
      signedOffBy: actor,
      version: current.version + 1,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(and(eq(checkGate.tenantId, config.TENANT_ID), eq(checkGate.id, current.id)))
    .returning();
  return toSnapshot(requireRow(updated, "闸门签核更新失败"));
}
