import { and, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { job } from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import { logger } from "../infra/logger.js";

export interface StartJobInput {
  jobType: "RUN" | "IMPORT" | "SYNC" | "EXPORT";
  refType: string;
  refId: string;
  idempotencyKey: string;
  actor: string;
  handler: () => Promise<Record<string, unknown>>;
}

/** 创建 Job 记录并在进程内异步执行；返回 jobId 供轮询 */
export async function startJob(input: StartJobInput): Promise<string> {
  const existing = await db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.tenantId, config.TENANT_ID),
        eq(job.idempotencyKey, input.idempotencyKey),
        isNull(job.deletedAt)
      )
    )
    .limit(1);
  if (existing[0] !== undefined) {
    return existing[0].id;
  }

  const jobId = ulid();
  await db.insert(job).values({
    id: jobId,
    tenantId: config.TENANT_ID,
    jobType: input.jobType,
    jobStatus: "QUEUED",
    refType: input.refType,
    refId: input.refId,
    progressPercent: 0,
    resultExt: null,
    errorCode: null,
    errorMessage: null,
    idempotencyKey: input.idempotencyKey,
    attemptCount: 0,
    startedAt: null,
    finishedAt: null,
    createdBy: input.actor,
    updatedBy: input.actor
  });

  void executeJob(jobId, input.handler);
  return jobId;
}

async function executeJob(
  jobId: string,
  handler: () => Promise<Record<string, unknown>>
): Promise<void> {
  const claimed = await db
    .update(job)
    .set({
      jobStatus: "RUNNING",
      progressPercent: 5,
      startedAt: sql`now()`,
      attemptCount: sql`${job.attemptCount} + 1`,
      updatedAt: sql`now()`
    })
    .where(
      and(
        eq(job.tenantId, config.TENANT_ID),
        eq(job.id, jobId),
        eq(job.jobStatus, "QUEUED")
      )
    )
    .returning({ id: job.id });
  if (claimed.length === 0) {
    return;
  }

  try {
    const result = await handler();
    await db
      .update(job)
      .set({
        jobStatus: "SUCCEEDED",
        progressPercent: 100,
        resultExt: result,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`
      })
      .where(and(eq(job.tenantId, config.TENANT_ID), eq(job.id, jobId)));
    logger.info({ event: "job.succeeded", jobId });
  } catch (error) {
    const appError = error instanceof AppError ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(job)
      .set({
        jobStatus: "FAILED",
        progressPercent: 100,
        errorCode: appError?.code ?? "BIZ_RECONCILIATION_SERVICE_INTERNAL",
        errorMessage: message.slice(0, 512),
        finishedAt: sql`now()`,
        updatedAt: sql`now()`
      })
      .where(and(eq(job.tenantId, config.TENANT_ID), eq(job.id, jobId)));
    logger.error({ event: "job.failed", jobId, error: message });
  }
}

/** 进程重启后把残留 RUNNING 标记为失败，避免永久占用 */
export async function recoverStaleJobs(): Promise<void> {
  const rows = await db
    .update(job)
    .set({
      jobStatus: "FAILED",
      errorCode: "BIZ_RECONCILIATION_JOB_UNAVAILABLE",
      errorMessage: "服务重启，运行中的作业已标记失败，请重放执行批次",
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedBy: "agent:startup"
    })
    .where(and(eq(job.tenantId, config.TENANT_ID), eq(job.jobStatus, "RUNNING")))
    .returning({ id: job.id });
  if (rows.length > 0) {
    logger.warn({ event: "job.recovered_stale", count: rows.length });
  }
}
