import { and, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { ulid } from "ulid";
import {
  datasetMappingSchema,
  parsePackConfig,
  type CheckStage
} from "@infra/biz-reconciliation-engine";
import { sha256, stableJson } from "@shared/utils";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { checkPack, checkPackVersion, sourceDataset, system } from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import { assertTransition } from "../domain/status.js";
import { requireRow } from "../infra/require.js";

export interface CreatePackInput {
  packCode: string;
  packName: string;
  checkStage: CheckStage;
  pairId?: string;
  description?: string;
}

export interface CreatePackVersionInput {
  config: unknown;
  sourceScripts: string[];
}

export interface PublishResult {
  versionId: string;
  versionNo: number;
  published: boolean;
}

function tenantId(): string {
  return config.TENANT_ID;
}

export async function listPacks(pairId?: string) {
  const conditions = [
    eq(checkPack.tenantId, tenantId()),
    isNull(checkPack.deletedAt)
  ];
  if (pairId !== undefined && pairId !== "") {
    conditions.push(eq(checkPack.pairId, pairId));
  }
  return db
    .select()
    .from(checkPack)
    .where(and(...conditions))
    .orderBy(checkPack.packCode);
}

export async function getPackById(id: string) {
  const rows = await db
    .select()
    .from(checkPack)
    .where(
      and(
        eq(checkPack.tenantId, tenantId()),
        eq(checkPack.id, id),
        isNull(checkPack.deletedAt)
      )
    )
    .limit(1);
  const pack = rows[0];
  if (pack === undefined) {
    throw new AppError("BIZ_RECONCILIATION_PACK_NOT_FOUND", `指标包 ${id} 不存在`);
  }
  return pack;
}

export async function listPackVersions(packId: string) {
  await getPackById(packId);
  return db
    .select()
    .from(checkPackVersion)
    .where(
      and(
        eq(checkPackVersion.tenantId, tenantId()),
        eq(checkPackVersion.packId, packId),
        isNull(checkPackVersion.deletedAt)
      )
    )
    .orderBy(desc(checkPackVersion.versionNo));
}

export async function getPackVersionById(id: string) {
  const rows = await db
    .select()
    .from(checkPackVersion)
    .where(
      and(
        eq(checkPackVersion.tenantId, tenantId()),
        eq(checkPackVersion.id, id),
        isNull(checkPackVersion.deletedAt)
      )
    )
    .limit(1);
  const version = rows[0];
  if (version === undefined) {
    throw new AppError("BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT", `规则版本 ${id} 不存在`);
  }
  return version;
}

export async function createPack(input: CreatePackInput, actor: string) {
  const existing = await db
    .select({ id: checkPack.id })
    .from(checkPack)
    .where(
      and(
        eq(checkPack.tenantId, tenantId()),
        eq(checkPack.packCode, input.packCode),
        isNull(checkPack.deletedAt)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    throw new AppError(
      "BIZ_RECONCILIATION_PACK_ALREADY_EXISTS",
      `指标包代码 ${input.packCode} 已存在`
    );
  }
  const [created] = await db
    .insert(checkPack)
    .values({
      id: ulid(),
      tenantId: tenantId(),
      packCode: input.packCode,
      packName: input.packName,
      checkStage: input.checkStage,
      pairId: input.pairId ?? null,
      packStatus: "DRAFT",
      description: input.description ?? null,
      createdBy: actor,
      updatedBy: actor
    })
    .returning();
  return requireRow(created, "指标包创建失败");
}

async function datasetCodesFromConfig(value: unknown): Promise<Set<string>> {
  const parsed = parsePackConfig(value);
  const codes = new Set<string>();
  for (const comparison of parsed.comparisons) {
    for (const dataset of [comparison.leftDataset, comparison.rightDataset]) {
      if (Array.isArray(dataset)) {
        dataset.forEach((code) => codes.add(code));
      } else {
        codes.add(dataset);
      }
    }
  }
  return codes;
}

export async function validatePackVersionConfig(value: unknown): Promise<{
  datasetCodes: string[];
}> {
  let parsed;
  try {
    parsed = parsePackConfig(value);
  } catch (error) {
    throw new AppError(
      "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT",
      `指标包配置校验失败: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof ZodError ? error.issues : undefined
    );
  }
  const codes = [...(await datasetCodesFromConfig(parsed))];
  if (codes.length === 0) {
    throw new AppError(
      "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT",
      "指标包未引用任何数据集"
    );
  }
  const found = await db
    .select({ code: sourceDataset.datasetCode })
    .from(sourceDataset)
    .where(
      and(
        eq(sourceDataset.tenantId, tenantId()),
        isNull(sourceDataset.deletedAt),
        inArray(sourceDataset.datasetCode, codes)
      )
    );
  const foundCodes = new Set(found.map((row) => row.code));
  const missing = codes.filter((code) => !foundCodes.has(code));
  if (missing.length > 0) {
    throw new AppError(
      "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT",
      `指标包引用了不存在的数据集: ${missing.join(", ")}`
    );
  }
  return { datasetCodes: codes };
}

export async function createPackVersion(
  packId: string,
  input: CreatePackVersionInput,
  actor: string
) {
  await getPackById(packId);
  await validatePackVersionConfig(input.config);
  const latest = await db
    .select({ versionNo: checkPackVersion.versionNo })
    .from(checkPackVersion)
    .where(
      and(
        eq(checkPackVersion.tenantId, tenantId()),
        eq(checkPackVersion.packId, packId),
        isNull(checkPackVersion.deletedAt)
      )
    )
    .orderBy(desc(checkPackVersion.versionNo))
    .limit(1);
  const versionNo = (latest[0]?.versionNo ?? 0) + 1;
  const configHash = sha256(stableJson(input.config));
  const [created] = await db
    .insert(checkPackVersion)
    .values({
      id: ulid(),
      tenantId: tenantId(),
      packId,
      versionNo,
      versionStatus: "DRAFT",
      configJson: input.config as Record<string, unknown>,
      configHash,
      sourceScripts: input.sourceScripts,
      createdBy: actor,
      updatedBy: actor
    })
    .returning();
  return requireRow(created, "指标包版本创建失败");
}

export async function publishPackVersion(
  packId: string,
  versionId: string,
  options: { dryRun: boolean; confirm: boolean },
  actor: string
): Promise<PublishResult> {
  await getPackById(packId);
  const version = await getPackVersionById(versionId);
  if (version.packId !== packId) {
    throw new AppError(
      "BIZ_RECONCILIATION_PACK_VERSION_CONFLICT",
      "规则版本不属于该指标包"
    );
  }
  assertTransition("PACK_VERSION", version.versionStatus, "PUBLISHED");
  await validatePackVersionConfig(version.configJson);

  if (options.dryRun) {
    return { versionId, versionNo: version.versionNo, published: false };
  }
  if (!options.confirm) {
    throw new AppError(
      "BIZ_RECONCILIATION_PACK_VERSION_DRYRUN_FAILED",
      "L3 发布必须显式 confirm=true"
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(checkPackVersion)
      .set({ versionStatus: "RETIRED", updatedBy: actor, updatedAt: sql`now()` })
      .where(
        and(
          eq(checkPackVersion.tenantId, tenantId()),
          eq(checkPackVersion.packId, packId),
          eq(checkPackVersion.versionStatus, "PUBLISHED")
        )
      );
    await tx
      .update(checkPackVersion)
      .set({
        versionStatus: "PUBLISHED",
        publishedAt: sql`now()`,
        publishedBy: actor,
        updatedBy: actor,
        updatedAt: sql`now()`
      })
      .where(
        and(
          eq(checkPackVersion.tenantId, tenantId()),
          eq(checkPackVersion.id, versionId)
        )
      );
    await tx
      .update(checkPack)
      .set({
        packStatus: "ACTIVE",
        currentVersionId: versionId,
        updatedBy: actor,
        updatedAt: sql`now()`
      })
      .where(and(eq(checkPack.tenantId, tenantId()), eq(checkPack.id, packId)));
  });

  return { versionId, versionNo: version.versionNo, published: true };
}

export async function getPublishedVersion(packId: string) {
  const rows = await db
    .select()
    .from(checkPackVersion)
    .where(
      and(
        eq(checkPackVersion.tenantId, tenantId()),
        eq(checkPackVersion.packId, packId),
        eq(checkPackVersion.versionStatus, "PUBLISHED"),
        isNull(checkPackVersion.deletedAt)
      )
    )
    .orderBy(desc(checkPackVersion.versionNo))
    .limit(1);
  const version = rows[0];
  if (version === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT",
      "指标包尚无已发布版本"
    );
  }
  return version;
}

export async function listDatasets() {
  return db
    .select({
      ...getTableColumns(sourceDataset),
      systemCode: system.systemCode
    })
    .from(sourceDataset)
    .leftJoin(system, eq(sourceDataset.systemId, system.id))
    .where(and(eq(sourceDataset.tenantId, tenantId()), isNull(sourceDataset.deletedAt)))
    .orderBy(sourceDataset.datasetCode);
}

export async function getDatasetByCode(datasetCode: string) {
  const rows = await db
    .select()
    .from(sourceDataset)
    .where(
      and(
        eq(sourceDataset.tenantId, tenantId()),
        eq(sourceDataset.datasetCode, datasetCode),
        isNull(sourceDataset.deletedAt)
      )
    )
    .limit(1);
  const dataset = rows[0];
  if (dataset === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_NOT_FOUND",
      `数据集 ${datasetCode} 不存在`
    );
  }
  return dataset;
}

export interface UpsertDatasetInput {
  datasetCode: string;
  datasetName: string;
  sourceSystem: string;
  systemId?: string;
  schemaKey?: string;
  sourceSchema?: string;
  transport: "FILE" | "READONLY_SQL";
  extractProfile?: string;
  mapping: unknown;
}

export async function upsertDataset(input: UpsertDatasetInput, actor: string) {
  const mapping = datasetMappingSchema.parse(input.mapping);
  const mappingHash = sha256(stableJson(mapping));
  const existing = await db
    .select()
    .from(sourceDataset)
    .where(
      and(
        eq(sourceDataset.tenantId, tenantId()),
        eq(sourceDataset.datasetCode, input.datasetCode),
        isNull(sourceDataset.deletedAt)
      )
    )
    .limit(1);
  const current = existing[0];
  if (current === undefined) {
    const [created] = await db
      .insert(sourceDataset)
      .values({
        id: ulid(),
        tenantId: tenantId(),
        datasetCode: input.datasetCode,
        datasetName: input.datasetName,
        sourceSystem: input.sourceSystem,
        systemId: input.systemId ?? null,
        schemaKey: input.schemaKey ?? "DEFAULT",
        sourceSchema: input.sourceSchema ?? null,
        transport: input.transport,
        extractProfile: input.extractProfile ?? null,
        mappingJson: input.mapping as Record<string, unknown>,
        mappingHash,
        datasetStatus: "ACTIVE",
        createdBy: actor,
        updatedBy: actor
      })
      .returning();
    return requireRow(created, "数据集创建失败");
  }
  const [updated] = await db
    .update(sourceDataset)
    .set({
      datasetName: input.datasetName,
      sourceSystem: input.sourceSystem,
      systemId: input.systemId ?? null,
      schemaKey: input.schemaKey ?? "DEFAULT",
      sourceSchema: input.sourceSchema ?? null,
      transport: input.transport,
      extractProfile: input.extractProfile ?? null,
      mappingJson: input.mapping as Record<string, unknown>,
      mappingHash,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(
      and(eq(sourceDataset.tenantId, tenantId()), eq(sourceDataset.id, current.id))
    )
    .returning();
  return requireRow(updated, "数据集更新失败");
}
