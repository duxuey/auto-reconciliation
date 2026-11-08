import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { job } from "../db/schema.js";
import { AppError } from "../domain/errors.js";

export async function getJobById(id: string) {
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.tenantId, config.TENANT_ID), eq(job.id, id), isNull(job.deletedAt)))
    .limit(1);
  const record = rows[0];
  if (record === undefined) {
    throw new AppError("BIZ_RECONCILIATION_JOB_NOT_FOUND", `作业 ${id} 不存在`);
  }
  return record;
}
