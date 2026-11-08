import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { parsePackConfig } from "@infra/biz-reconciliation-engine";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { importBatch, stagingRecord } from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import { getPublishedVersion, listDatasets, listPacks } from "./catalog.js";
import { getPairById, resolveDatasetDatasource, resolveEnvironment } from "./environments.js";

export interface PairReadinessInput {
  pairId: string;
  environmentId?: string;
  periodStartDate: string;
  periodEndDate: string;
}

export type DatasetReadinessStatus =
  | "READY"
  | "MISSING"
  | "PARTIAL"
  | "FAILED"
  | "STALE"
  | "PROCESSING"
  | "NO_EXTRACT"
  | "NO_DATASOURCE"
  | "NO_DATASET";

export interface DatasetReadiness {
  datasetCode: string;
  datasetName: string;
  sourceSystem: string;
  transport: "FILE" | "READONLY_SQL";
  side: "LEFT" | "RIGHT" | "BOTH";
  packCodes: string[];
  packNames: string[];
  latestBatch: {
    id: string;
    importStatus: string;
    rowTotal: number;
    rowLoaded: number;
    rowRejected: number;
    fileName: string | null;
    periodStartDate: string;
    periodEndDate: string;
    createdAt: string;
  } | null;
  stagedRows: number;
  /** DIRECT：执行时直连源库；STAGING：依赖已暂存/上传文件 */
  dataSource: "DIRECT" | "STAGING";
  /** 直连数据源解析失败时的脱敏原因 */
  datasourceError: string | null;
  status: DatasetReadinessStatus;
  blocking: boolean;
}

export interface PackReadiness {
  packId: string;
  packCode: string;
  packName: string;
  publishedVersionId: string | null;
  versionNo: number | null;
  requiredDatasetCodes: string[];
  ready: boolean;
  blockingDatasetCodes: string[];
}

export interface PairReadiness {
  pairId: string;
  environmentId: string;
  periodStartDate: string;
  periodEndDate: string;
  packs: PackReadiness[];
  datasets: DatasetReadiness[];
  skippedPacks: Array<{
    packId: string;
    packCode: string;
    packName: string;
    reason: "INACTIVE" | "NO_PUBLISHED_VERSION";
  }>;
  summary: {
    packCount: number;
    readyPackCount: number;
    datasetCount: number;
    readyDatasetCount: number;
    blockingDatasetCount: number;
    canRun: boolean;
  };
}

interface DatasetRequirement {
  side: "LEFT" | "RIGHT" | "BOTH";
  packCodes: Set<string>;
  packNames: Set<string>;
}

function addRequirement(
  requirements: Map<string, DatasetRequirement>,
  code: string,
  side: "LEFT" | "RIGHT",
  packCode: string,
  packName: string
) {
  const existing = requirements.get(code);
  if (existing === undefined) {
    requirements.set(code, {
      side,
      packCodes: new Set([packCode]),
      packNames: new Set([packName])
    });
    return;
  }
  existing.side = existing.side === side ? side : "BOTH";
  existing.packCodes.add(packCode);
  existing.packNames.add(packName);
}

export async function getPairReadiness(input: PairReadinessInput): Promise<PairReadiness> {
  if (input.periodStartDate > input.periodEndDate) {
    throw new AppError(
      "BIZ_RECONCILIATION_RUN_INVALID_INPUT",
      "期间起日不能晚于止日"
    );
  }
  await getPairById(input.pairId);
  const environment = await resolveEnvironment({ environmentId: input.environmentId });
  const packs = await listPacks(input.pairId);
  const datasets = await listDatasets();
  const datasetByCode = new Map(datasets.map((item) => [item.datasetCode, item]));

  const requirements = new Map<string, DatasetRequirement>();
  const packReadiness: PackReadiness[] = [];
  const skippedPacks: PairReadiness["skippedPacks"] = [];

  for (const pack of packs) {
    if (pack.packStatus !== "ACTIVE") {
      skippedPacks.push({
        packId: pack.id,
        packCode: pack.packCode,
        packName: pack.packName,
        reason: "INACTIVE"
      });
      continue;
    }
    let version;
    try {
      version = await getPublishedVersion(pack.id);
    } catch {
      skippedPacks.push({
        packId: pack.id,
        packCode: pack.packCode,
        packName: pack.packName,
        reason: "NO_PUBLISHED_VERSION"
      });
      continue;
    }
    const packConfig = parsePackConfig(version.configJson);
    const required = new Set<string>();
    for (const comparison of packConfig.comparisons) {
      const pairs: Array<["LEFT" | "RIGHT", string | string[]]> = [
        ["LEFT", comparison.leftDataset],
        ["RIGHT", comparison.rightDataset]
      ];
      for (const [side, reference] of pairs) {
        const codes = Array.isArray(reference) ? reference : [reference];
        for (const code of codes) {
          required.add(code);
          addRequirement(requirements, code, side, pack.packCode, pack.packName);
        }
      }
    }
    packReadiness.push({
      packId: pack.id,
      packCode: pack.packCode,
      packName: pack.packName,
      publishedVersionId: version.id,
      versionNo: version.versionNo,
      requiredDatasetCodes: [...required],
      ready: false,
      blockingDatasetCodes: []
    });
  }

  const datasetReadiness: DatasetReadiness[] = [];
  for (const [code, requirement] of requirements) {
    const metadata = datasetByCode.get(code);
    if (metadata === undefined) {
      datasetReadiness.push({
        datasetCode: code,
        datasetName: code,
        sourceSystem: "-",
        transport: "FILE",
        side: requirement.side,
        packCodes: [...requirement.packCodes],
        packNames: [...requirement.packNames],
        latestBatch: null,
        stagedRows: 0,
        dataSource: "STAGING",
        datasourceError: null,
        status: "NO_DATASET",
        blocking: true
      });
      continue;
    }

    const batches = await db
      .select()
      .from(importBatch)
      .where(
        and(
          eq(importBatch.tenantId, config.TENANT_ID),
          eq(importBatch.datasetCode, code),
          eq(importBatch.environmentId, environment.id),
          lte(importBatch.periodStartDate, input.periodEndDate),
          gte(importBatch.periodEndDate, input.periodStartDate),
          isNull(importBatch.deletedAt)
        )
      )
      .orderBy(desc(importBatch.createdAt))
      .limit(1);
    const latestBatch = batches[0];
    const isDirect =
      metadata.transport === "READONLY_SQL" && metadata.extractProfile !== null;

    let status: DatasetReadinessStatus;
    let stagedRows = 0;
    let datasourceError: string | null = null;

    if (isDirect) {
      // 直连模式：就绪只看配置能否解析；真实连接失败在执行时以脱敏错误呈现
      try {
        await resolveDatasetDatasource(metadata, {
          environment,
          strict: true
        });
        status = "READY";
      } catch (error) {
        status = "NO_DATASOURCE";
        datasourceError =
          error instanceof AppError ? error.message : "源库配置无法解析";
      }
    } else if (metadata.transport === "READONLY_SQL") {
      status = "NO_EXTRACT";
      datasourceError = "未配置只读抽取";
    } else {
      const staged = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(stagingRecord)
        .where(
          and(
            eq(stagingRecord.tenantId, config.TENANT_ID),
            eq(stagingRecord.datasetCode, code),
            eq(stagingRecord.environmentId, environment.id),
            gte(stagingRecord.businessDate, input.periodStartDate),
            lte(stagingRecord.businessDate, input.periodEndDate),
            isNull(stagingRecord.deletedAt)
          )
        );
      stagedRows = staged[0]?.count ?? 0;

      if (stagedRows > 0) {
        status = latestBatch?.importStatus === "PARTIAL" ? "PARTIAL" : "READY";
      } else if (latestBatch === undefined) {
        status = "MISSING";
      } else if (latestBatch.importStatus === "FAILED") {
        status = "FAILED";
      } else if (
        latestBatch.importStatus === "PENDING" ||
        latestBatch.importStatus === "VALIDATING"
      ) {
        status = "PROCESSING";
      } else {
        status = "STALE";
      }
    }

    datasetReadiness.push({
      datasetCode: code,
      datasetName: metadata.datasetName,
      sourceSystem: metadata.sourceSystem,
      transport: metadata.transport === "READONLY_SQL" ? "READONLY_SQL" : "FILE",
      side: requirement.side,
      packCodes: [...requirement.packCodes],
      packNames: [...requirement.packNames],
      latestBatch:
        latestBatch === undefined
          ? null
          : {
              id: latestBatch.id,
              importStatus: latestBatch.importStatus,
              rowTotal: latestBatch.rowTotal,
              rowLoaded: latestBatch.rowLoaded,
              rowRejected: latestBatch.rowRejected,
              fileName: latestBatch.fileName,
              periodStartDate: latestBatch.periodStartDate,
              periodEndDate: latestBatch.periodEndDate,
              createdAt: latestBatch.createdAt.toISOString()
            },
      stagedRows,
      dataSource: isDirect ? "DIRECT" : "STAGING",
      datasourceError,
      status,
      blocking: status !== "READY" && status !== "PARTIAL"
    });
  }

  const readinessByCode = new Map(
    datasetReadiness.map((item) => [item.datasetCode, item])
  );
  for (const pack of packReadiness) {
    pack.blockingDatasetCodes = pack.requiredDatasetCodes.filter(
      (code) => readinessByCode.get(code)?.blocking !== false
    );
    pack.ready = pack.blockingDatasetCodes.length === 0;
  }

  const readyPackCount = packReadiness.filter((pack) => pack.ready).length;
  const blockingDatasetCount = datasetReadiness.filter((item) => item.blocking).length;
  return {
    pairId: input.pairId,
    environmentId: environment.id,
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
    packs: packReadiness,
    datasets: datasetReadiness,
    skippedPacks,
    summary: {
      packCount: packReadiness.length,
      readyPackCount,
      datasetCount: datasetReadiness.length,
      readyDatasetCount: datasetReadiness.length - blockingDatasetCount,
      blockingDatasetCount,
      canRun: readyPackCount > 0
    }
  };
}
