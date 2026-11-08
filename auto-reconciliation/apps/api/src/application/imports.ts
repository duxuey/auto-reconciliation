import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { detectFormat, importFile, type FileFormat, type RowError } from "@adapter/file";
import {
  createLegacyPool,
  EXTRACT_PROFILES,
  runExtract,
  type ExtractProfileCode
} from "@adapter/legacy-mysql";
import {
  datasetMappingSchema,
  mapSourceRecord,
  type MappedRecordInput
} from "@infra/biz-reconciliation-engine";
import { sha256 } from "@shared/utils";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { importBatch, importRowError, sourceDataset, stagingRecord } from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import { logger } from "../infra/logger.js";
import { sanitizeForLog } from "../infra/mask.js";
import { getDatasetByCode } from "./catalog.js";
import {
  datasourceFingerprint,
  resolveDatasetDatasource,
  resolveEnvironment
} from "./environments.js";
import {
  extractionContentHash,
  extractionSyncKey,
  findDuplicateExternalIds,
  sanitizeExtractionFailure,
  toExclusivePeriodEnd
} from "./extraction.js";

type DatasetRow = typeof sourceDataset.$inferSelect;

export async function listImportBatches(limit = 100, environmentId?: string) {
  const conditions = [
    eq(importBatch.tenantId, config.TENANT_ID),
    isNull(importBatch.deletedAt)
  ];
  if (environmentId !== undefined && environmentId !== "") {
    conditions.push(eq(importBatch.environmentId, environmentId));
  }
  return db
    .select()
    .from(importBatch)
    .where(and(...conditions))
    .orderBy(desc(importBatch.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getImportBatchById(id: string) {
  const rows = await db
    .select()
    .from(importBatch)
    .where(
      and(
        eq(importBatch.tenantId, config.TENANT_ID),
        eq(importBatch.id, id),
        isNull(importBatch.deletedAt)
      )
    )
    .limit(1);
  const batch = rows[0];
  if (batch === undefined) {
    throw new AppError("BIZ_RECONCILIATION_IMPORT_NOT_FOUND", `导入批次 ${id} 不存在`);
  }
  return batch;
}

export async function listImportRowErrors(batchId: string) {
  await getImportBatchById(batchId);
  return db
    .select()
    .from(importRowError)
    .where(
      and(
        eq(importRowError.tenantId, config.TENANT_ID),
        eq(importRowError.importBatchId, batchId)
      )
    )
    .orderBy(asc(importRowError.rowNo))
    .limit(1000);
}

export interface ImportFileInput {
  datasetCode: string;
  fileName: string;
  content: string;
  format?: FileFormat;
  environmentId?: string;
  periodStartDate: string;
  periodEndDate: string;
  actor: string;
}

interface PersistInput {
  dataset: DatasetRow;
  batchId: string;
  environmentId: string | null;
  rows: MappedRecordInput[];
  errors: RowError[];
  periodStartDate: string;
  periodEndDate: string;
  actor: string;
  rowTotal: number;
  /** 直连抽取复用 PENDING/FAILED 批次时，先清理旧暂存与行错误 */
  replace?: boolean;
}

function businessKeyText(row: MappedRecordInput): string {
  // 与指标引擎一致：键名排序后拼接，避免 JSONB 键序差异导致无法钻取
  const keys = Object.keys(row.businessKey).sort();
  return keys.map((key) => row.businessKey[key] ?? "").join("|");
}

async function persistRecords(input: PersistInput): Promise<void> {
  const { dataset, batchId, environmentId, rows, errors, actor, periodStartDate, periodEndDate } =
    input;
  const status = errors.length === 0 ? "LOADED" : rows.length === 0 ? "FAILED" : "PARTIAL";

  await db.transaction(async (tx) => {
    if (input.replace === true) {
      await tx
        .delete(importRowError)
        .where(
          and(
            eq(importRowError.tenantId, config.TENANT_ID),
            eq(importRowError.importBatchId, batchId)
          )
        );
      await tx
        .delete(stagingRecord)
        .where(
          and(
            eq(stagingRecord.tenantId, config.TENANT_ID),
            eq(stagingRecord.importBatchId, batchId)
          )
        );
    }

    if (errors.length > 0) {
      await tx.insert(importRowError).values(
        errors.map((error) => ({
          id: ulid(),
          tenantId: config.TENANT_ID,
          importBatchId: batchId,
          rowNo: error.rowNo,
          errorCode: "BIZ_RECONCILIATION_IMPORT_INVALID_INPUT",
          errorMessage: error.message.slice(0, 512),
          rawExt: null,
          createdBy: actor
        }))
      );
    }

    const chunkSize = 500;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      await tx
        .insert(stagingRecord)
        .values(
          chunk.map((row) => ({
            id: ulid(),
            tenantId: config.TENANT_ID,
            datasetCode: dataset.datasetCode,
            environmentId,
            sourceSystem: dataset.sourceSystem,
            externalId: row.externalId.slice(0, 128),
            periodCode:
              row.periodCode ??
              periodStartDate.slice(0, 7).replace("-", ""),
            businessKeyText: businessKeyText(row).slice(0, 512),
            businessKeyExt: row.businessKey,
            attributesExt: row.attributes,
            amountsExt: row.amounts,
            currency: row.currency,
            businessDate: row.businessDate,
            recordStatus: row.recordStatus,
            sourcePayloadExt: sanitizeForLog(row.raw) as Record<string, unknown>,
            importBatchId: batchId,
            createdBy: actor,
            updatedBy: actor
          }))
        )
        .onConflictDoNothing();
    }

    await tx
      .update(importBatch)
      .set({
        rowTotal: input.rowTotal,
        rowLoaded: rows.length,
        rowRejected: errors.length,
        importStatus: status,
        periodStartDate,
        periodEndDate,
        updatedBy: actor,
        updatedAt: sql`now()`
      })
      .where(and(eq(importBatch.tenantId, config.TENANT_ID), eq(importBatch.id, batchId)));
  });
}

export async function importFileBatch(input: ImportFileInput): Promise<{
  batchId: string;
  duplicated: boolean;
  status: string;
  loaded: number;
  rejected: number;
}> {
  const dataset = await getDatasetByCode(input.datasetCode);
  const environment = await resolveEnvironment({
    environmentId: input.environmentId
  }).catch(() => null);
  const environmentId = environment?.id ?? null;
  const format = input.format ?? detectFormat(input.fileName);
  const fileHash = sha256(input.content);
  const existing = await db
    .select()
    .from(importBatch)
    .where(
      and(
        eq(importBatch.tenantId, config.TENANT_ID),
        eq(importBatch.datasetCode, dataset.datasetCode),
        // 同一文件在不同环境属于不同批次，避免串用旧环境暂存数据
        environmentId === null
          ? isNull(importBatch.environmentId)
          : eq(importBatch.environmentId, environmentId),
        eq(importBatch.fileHash, fileHash),
        eq(importBatch.mappingHash, dataset.mappingHash),
        isNull(importBatch.deletedAt)
      )
    )
    .limit(1);
  const previous = existing[0];
  if (previous !== undefined && previous.importStatus !== "FAILED") {
    return {
      batchId: previous.id,
      duplicated: true,
      status: previous.importStatus,
      loaded: previous.rowLoaded,
      rejected: previous.rowRejected
    };
  }

  let batchId: string;
  if (previous === undefined) {
    batchId = ulid();
    await db.insert(importBatch).values({
      id: batchId,
      tenantId: config.TENANT_ID,
      datasetCode: dataset.datasetCode,
      environmentId,
      transport: "FILE",
      fileName: input.fileName.slice(0, 256),
      fileHash,
      mappingHash: dataset.mappingHash,
      syncKey: null,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      rowTotal: 0,
      rowLoaded: 0,
      rowRejected: 0,
      importStatus: "PENDING",
      jobId: null,
      createdBy: input.actor,
      updatedBy: input.actor
    });
  } else {
    batchId = previous.id;
    await db
      .delete(importRowError)
      .where(
        and(
          eq(importRowError.tenantId, config.TENANT_ID),
          eq(importRowError.importBatchId, batchId)
        )
      );
    await db
      .update(importBatch)
      .set({
        importStatus: "PENDING",
        rowTotal: 0,
        rowLoaded: 0,
        rowRejected: 0,
        updatedBy: input.actor,
        updatedAt: sql`now()`
      })
      .where(and(eq(importBatch.tenantId, config.TENANT_ID), eq(importBatch.id, batchId)));
  }

  let parsed;
  try {
    parsed = importFile(input.content, format, dataset.mappingJson, {
      zone: config.BUSINESS_TIME_ZONE,
      defaultPeriodCode: input.periodStartDate.slice(0, 7).replace("-", "")
    });
  } catch (error) {
    await db
      .update(importBatch)
      .set({
        importStatus: "FAILED",
        updatedBy: input.actor,
        updatedAt: sql`now()`
      })
      .where(and(eq(importBatch.tenantId, config.TENANT_ID), eq(importBatch.id, batchId)));
    throw new AppError(
      "BIZ_RECONCILIATION_IMPORT_INVALID_INPUT",
      error instanceof Error ? error.message : String(error)
    );
  }

  await persistRecords({
    dataset,
    batchId,
    environmentId,
    rows: parsed.rows,
    errors: parsed.errors,
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
    actor: input.actor,
    rowTotal: parsed.rows.length + parsed.errors.length
  });

  const status = parsed.errors.length === 0 ? "LOADED" : parsed.rows.length === 0 ? "FAILED" : "PARTIAL";
  return {
    batchId,
    duplicated: false,
    status,
    loaded: parsed.rows.length,
    rejected: parsed.errors.length
  };
}

export interface ExtractDatasetInput {
  datasetCode: string;
  environmentId?: string;
  periodStartDate: string;
  periodEndDate: string;
  actor: string;
}

export interface ExtractDatasetResult {
  datasetCode: string;
  batchId: string;
  status: string;
  loaded: number;
  rejected: number;
  reused: boolean;
  contentHash: string;
}

/**
 * 执行时直连源库抽取：不要求事先导入/同步。
 * 抽取结果按内容哈希复用批次；源库内容变化才生成新批次。
 */
export async function extractDatasetDirect(
  input: ExtractDatasetInput
): Promise<ExtractDatasetResult> {
  const dataset = await getDatasetByCode(input.datasetCode);
  if (dataset.transport !== "READONLY_SQL" || dataset.extractProfile === null) {
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
      `数据集 ${dataset.datasetCode} 未配置只读抽取`
    );
  }
  const extractProfile = dataset.extractProfile;
  if (!(extractProfile in EXTRACT_PROFILES)) {
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
      `抽取配置 ${extractProfile} 未登记`
    );
  }
  const mapping = datasetMappingSchema.parse(dataset.mappingJson);
  if (mapping.businessDate === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
      `数据集 ${dataset.datasetCode} 未配置业务日期映射，无法按期间直连抽取`
    );
  }
  const datasource = await resolveDatasetDatasource(dataset, {
    environmentId: input.environmentId,
    strict: true
  });
  const environmentId = datasource.environmentId === "" ? null : datasource.environmentId;

  const pool = createLegacyPool({
    host: datasource.host,
    port: datasource.port,
    user: datasource.user,
    password: datasource.password,
    database: datasource.database,
    connectionLimit: datasource.connectionLimit
  });
  const rows: MappedRecordInput[] = [];
  const errors: RowError[] = [];
  try {
    const sourceRows = await runExtract(
      pool,
      extractProfile as ExtractProfileCode,
      {
        periodStartDate: input.periodStartDate,
        // SQL 使用半开区间：闭区间止日 + 1 天，保证单日期间也能抽取
        periodEndDate: toExclusivePeriodEnd(input.periodEndDate)
      },
      datasource.schemaName
    );
    sourceRows.forEach((source, index) => {
      try {
        const row = mapSourceRecord(source, mapping, {
          zone: config.BUSINESS_TIME_ZONE,
          defaultPeriodCode: input.periodStartDate.slice(0, 7).replace("-", "")
        });
        if (row.businessDate === null) {
          errors.push({ rowNo: index + 1, message: "业务日期为空" });
          return;
        }
        if (
          row.businessDate < input.periodStartDate ||
          row.businessDate > input.periodEndDate
        ) {
          errors.push({
            rowNo: index + 1,
            message: `业务日期 ${row.businessDate} 不在抽取期间内`
          });
          return;
        }
        rows.push(row);
      } catch (error) {
        errors.push({
          rowNo: index + 1,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });
  } catch (error) {
    logger.warn({
      event: "extract.direct.failed",
      datasetCode: dataset.datasetCode,
      environmentId,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
      sanitizeExtractionFailure(error, dataset.datasetCode)
    );
  } finally {
    await pool.end();
  }

  const duplicates = findDuplicateExternalIds(rows);
  if (duplicates.length > 0) {
    logger.warn({
      event: "extract.direct.duplicate_external_id",
      datasetCode: dataset.datasetCode,
      environmentId,
      duplicateCount: duplicates.length
    });
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
      `数据集 ${dataset.datasetCode} 存在 ${duplicates.length} 个重复外部主键，请检查抽取口径`
    );
  }

  const hashInput = {
    datasetCode: dataset.datasetCode,
    mappingHash: dataset.mappingHash,
    datasourceKey: datasourceFingerprint(datasource),
    extractProfile,
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
    rows,
    errors: errors.map((error) => ({ rowNo: error.rowNo, message: error.message }))
  };
  const contentHash = extractionContentHash(hashInput);
  const baseSyncKey = extractionSyncKey(hashInput);
  const status = errors.length === 0 ? "LOADED" : rows.length === 0 ? "FAILED" : "PARTIAL";

  const existingRows = await db
    .select()
    .from(importBatch)
    .where(
      and(
        eq(importBatch.tenantId, config.TENANT_ID),
        eq(importBatch.syncKey, baseSyncKey),
        isNull(importBatch.deletedAt)
      )
    )
    .limit(1);
  const existing = existingRows[0];
  if (existing !== undefined) {
    const countsMatch =
      existing.rowLoaded === rows.length && existing.rowRejected === errors.length;
    if (
      countsMatch &&
      (existing.importStatus === "LOADED" || existing.importStatus === "PARTIAL")
    ) {
      logger.info({
        event: "extract.direct.reused",
        datasetCode: dataset.datasetCode,
        environmentId,
        batchId: existing.id,
        loaded: rows.length,
        rejected: errors.length
      });
      return {
        datasetCode: dataset.datasetCode,
        batchId: existing.id,
        status: existing.importStatus,
        loaded: rows.length,
        rejected: errors.length,
        reused: true,
        contentHash
      };
    }
    if (existing.importStatus === "PENDING" || existing.importStatus === "FAILED") {
      await persistRecords({
        dataset,
        batchId: existing.id,
        environmentId,
        rows,
        errors,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        actor: input.actor,
        rowTotal: rows.length + errors.length,
        replace: true
      });
      logger.info({
        event: "extract.direct.rewritten",
        datasetCode: dataset.datasetCode,
        environmentId,
        batchId: existing.id,
        loaded: rows.length,
        rejected: errors.length
      });
      return {
        datasetCode: dataset.datasetCode,
        batchId: existing.id,
        status,
        loaded: rows.length,
        rejected: errors.length,
        reused: false,
        contentHash
      };
    }
  }

  // 同内容但既有批次已被引用且计数异常：用新键落新批次，绝不覆盖历史批次
  const syncKey =
    existing === undefined ? baseSyncKey : sha256(`${baseSyncKey}|retry|${ulid()}`);
  const batchId = ulid();
  const inserted = await db
    .insert(importBatch)
    .values({
      id: batchId,
      tenantId: config.TENANT_ID,
      datasetCode: dataset.datasetCode,
      environmentId,
      transport: "READONLY_SQL",
      fileName: null,
      fileHash: null,
      mappingHash: dataset.mappingHash,
      syncKey,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      rowTotal: 0,
      rowLoaded: 0,
      rowRejected: 0,
      importStatus: "PENDING",
      jobId: null,
      createdBy: input.actor,
      updatedBy: input.actor
    })
    .onConflictDoNothing()
    .returning({ id: importBatch.id });

  if (inserted[0] === undefined) {
    const concurrent = await db
      .select()
      .from(importBatch)
      .where(
        and(
          eq(importBatch.tenantId, config.TENANT_ID),
          eq(importBatch.syncKey, syncKey),
          isNull(importBatch.deletedAt)
        )
      )
      .limit(1);
    const row = concurrent[0];
    if (
      row !== undefined &&
      row.rowLoaded === rows.length &&
      row.rowRejected === errors.length &&
      (row.importStatus === "LOADED" || row.importStatus === "PARTIAL")
    ) {
      return {
        datasetCode: dataset.datasetCode,
        batchId: row.id,
        status: row.importStatus,
        loaded: rows.length,
        rejected: errors.length,
        reused: true,
        contentHash
      };
    }
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
      `数据集 ${dataset.datasetCode} 抽取并发冲突，请稍后重试`
    );
  }

  await persistRecords({
    dataset,
    batchId,
    environmentId,
    rows,
    errors,
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
    actor: input.actor,
    rowTotal: rows.length + errors.length
  });

  logger.info({
    event: "extract.direct.completed",
    datasetCode: dataset.datasetCode,
    environmentId,
    batchId,
    loaded: rows.length,
    rejected: errors.length,
    status
  });

  return {
    datasetCode: dataset.datasetCode,
    batchId,
    status,
    loaded: rows.length,
    rejected: errors.length,
    reused: false,
    contentHash
  };
}

export type SyncDatasetInput = ExtractDatasetInput;

export async function syncDataset(input: SyncDatasetInput): Promise<{
  batchId: string;
  duplicated: boolean;
  status: string;
  loaded: number;
  rejected: number;
}> {
  const result = await extractDatasetDirect(input);
  return {
    batchId: result.batchId,
    duplicated: result.reused,
    status: result.status,
    loaded: result.loaded,
    rejected: result.rejected
  };
}
