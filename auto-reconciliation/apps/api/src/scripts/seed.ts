import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { config } from "../config.js";
import { db, pool } from "../db/client.js";
import { checkPack, system, systemPair } from "../db/schema.js";
import { logger } from "../infra/logger.js";
import {
  buildEnvironmentSeeds,
  DATASET_SEEDS,
  ENVIRONMENT_SYSTEM_SEEDS,
  PACK_SEEDS,
  PAIR_SEEDS,
  SYSTEM_SEEDS,
  type PackSeed,
  type PairSeed,
  type SystemSeed
} from "../seed/configs.js";
import {
  createPack,
  createPackVersion,
  listPackVersions,
  listPacks,
  publishPackVersion,
  upsertDataset
} from "../application/catalog.js";
import {
  createEnvironment,
  getEnvironmentByCode,
  getSystemByCode,
  upsertEnvironmentSystem
} from "../application/environments.js";
import { importFileBatch } from "../application/imports.js";
import { createRun } from "../application/runs.js";
import { getGate } from "../application/gates.js";

const actor = "agent:seed";
const periodStartDate = "2026-10-01";
const periodEndDate = "2026-10-31";
const fixturesDir = fileURLToPath(new URL("../../../../fixtures/datasets", import.meta.url));

const FIXTURES: Record<string, string> = {
  RI_ACC_FAC_IN: "ri_acc_fac_in.csv",
  RI_ACC_TRTY_IN: "ri_acc_trty_in.csv",
  RI_ACC_XOL_TRTY_IN: "ri_acc_xol_trty_in.csv",
  RP_RI_BILL: "rp_ri_bill.csv",
  IFAC_PLCY: "ifac_plcy.csv",
  RI_INTF_PLCY: "ri_intf_plcy.csv",
  CLM_OUTST: "clm_outst.csv",
  RI_INTF_CLM_OUTST: "ri_intf_clm_outst.csv",
  CLM_OUTST_COINS: "clm_outst_coins.csv",
  RI_INTF_CLM_COINS: "ri_intf_clm_coins.csv",
  IFAC_CLM_OUTST: "ifac_clm_outst.csv",
  RI_INTF_CLM_OUTST_FAC: "ri_intf_clm_outst_fac.csv",
  CLM_OUTST_DTL: "clm_outst_dtl.csv",
  RI_INTF_CLM_CVRG_FEE: "ri_intf_clm_cvrg_fee.csv"
};

async function ensureEnvironment(seed: ReturnType<typeof buildEnvironmentSeeds>[number]) {
  const existing = await getEnvironmentByCode(seed.envCode).catch(() => undefined);
  if (existing !== undefined) {
    return existing;
  }
  return createEnvironment(seed, actor);
}

async function ensureSystem(seed: SystemSeed) {
  const existing = await getSystemByCode(seed.systemCode).catch(() => undefined);
  if (existing !== undefined) {
    return existing;
  }
  const [created] = await db
    .insert(system)
    .values({
      id: ulid(),
      tenantId: config.TENANT_ID,
      systemCode: seed.systemCode,
      systemName: seed.systemName,
      systemType: seed.systemType,
      description: seed.description ?? null,
      systemStatus: "ACTIVE",
      sortOrder: seed.sortOrder,
      createdBy: actor,
      updatedBy: actor
    })
    .returning();
  if (created === undefined) {
    throw new Error(`系统 ${seed.systemCode} 创建失败`);
  }
  return created;
}

async function ensurePair(seed: PairSeed, systemIdByCode: Map<string, string>) {
  const existing = await db
    .select()
    .from(systemPair)
    .where(
      and(
        eq(systemPair.tenantId, config.TENANT_ID),
        eq(systemPair.pairCode, seed.pairCode),
        isNull(systemPair.deletedAt)
      )
    )
    .limit(1);
  if (existing[0] !== undefined) {
    return existing[0];
  }
  const leftSystemId = systemIdByCode.get(seed.leftSystemCode);
  const rightSystemId = systemIdByCode.get(seed.rightSystemCode);
  if (leftSystemId === undefined || rightSystemId === undefined) {
    throw new Error(`对账关系 ${seed.pairCode} 引用的系统不存在`);
  }
  const [created] = await db
    .insert(systemPair)
    .values({
      id: ulid(),
      tenantId: config.TENANT_ID,
      pairCode: seed.pairCode,
      pairName: seed.pairName,
      leftSystemId,
      rightSystemId,
      pairStatus: "ACTIVE",
      description: seed.description ?? null,
      sortOrder: seed.sortOrder,
      createdBy: actor,
      updatedBy: actor
    })
    .returning();
  if (created === undefined) {
    throw new Error(`对账关系 ${seed.pairCode} 创建失败`);
  }
  return created;
}

async function ensurePack(
  seed: PackSeed,
  pairIdByCode: Map<string, string>
): Promise<{ packId: string; versionId: string }> {
  const packs = await listPacks();
  let pack = packs.find((item) => item.packCode === seed.packCode);
  const pairId =
    seed.pairCode === undefined ? undefined : pairIdByCode.get(seed.pairCode);
  if (seed.pairCode !== undefined && pairId === undefined) {
    throw new Error(`指标包 ${seed.packCode} 引用的对账关系 ${seed.pairCode} 不存在`);
  }
  if (pack === undefined) {
    pack = await createPack(
      {
        packCode: seed.packCode,
        packName: seed.packName,
        checkStage: seed.checkStage,
        pairId,
        description: seed.description
      },
      actor
    );
  } else if (pairId !== undefined && pack.pairId !== pairId) {
    // 对账关系为后续引入：已有指标包回填 pair_id
    const [updated] = await db
      .update(checkPack)
      .set({ pairId, updatedBy: actor, updatedAt: sql`now()` })
      .where(and(eq(checkPack.tenantId, config.TENANT_ID), eq(checkPack.id, pack.id)))
      .returning();
    if (updated === undefined) {
      throw new Error(`指标包 ${seed.packCode} 对账关系回填失败`);
    }
    pack = updated;
  }

  let versions = await listPackVersions(pack.id);
  let published = versions.find((item) => item.versionStatus === "PUBLISHED");
  if (published === undefined) {
    const created = await createPackVersion(
      pack.id,
      { config: seed.config, sourceScripts: seed.sourceScripts },
      actor
    );
    await publishPackVersion(
      pack.id,
      created.id,
      { dryRun: true, confirm: false },
      actor
    );
    await publishPackVersion(
      pack.id,
      created.id,
      { dryRun: false, confirm: true },
      actor
    );
    versions = await listPackVersions(pack.id);
    published = versions.find((item) => item.versionStatus === "PUBLISHED");
  }
  if (published === undefined) {
    throw new Error(`指标包 ${seed.packCode} 发布失败`);
  }
  return { packId: pack.id, versionId: published.id };
}

async function main(): Promise<void> {
  logger.info({ event: "seed.start", periodStartDate, periodEndDate });

  // 1. 环境
  const environmentSeeds = buildEnvironmentSeeds({
    host: config.LEGACY_MYSQL_HOST,
    port: config.LEGACY_MYSQL_PORT,
    user: config.LEGACY_MYSQL_USER,
    database: config.LEGACY_MYSQL_DATABASE
  });
  const environmentByCode = new Map<string, Awaited<ReturnType<typeof ensureEnvironment>>>();
  for (const seed of environmentSeeds) {
    const row = await ensureEnvironment(seed);
    environmentByCode.set(seed.envCode, row);
    logger.info({ event: "seed.environment", envCode: row.envCode, isDefault: row.isDefault });
  }
  const testEnvironment = environmentByCode.get("TEST");
  if (testEnvironment === undefined) {
    throw new Error("缺少 TEST 环境");
  }

  // 2. 系统与对账关系
  const systemIdByCode = new Map<string, string>();
  for (const seed of SYSTEM_SEEDS) {
    const row = await ensureSystem(seed);
    systemIdByCode.set(seed.systemCode, row.id);
    logger.info({ event: "seed.system", systemCode: row.systemCode });
  }
  const pairIdByCode = new Map<string, string>();
  for (const seed of PAIR_SEEDS) {
    const row = await ensurePair(seed, systemIdByCode);
    pairIdByCode.set(seed.pairCode, row.id);
    logger.info({ event: "seed.pair", pairCode: row.pairCode });
  }

  // 3. 环境×系统 schema 映射
  for (const seed of ENVIRONMENT_SYSTEM_SEEDS) {
    const env = environmentByCode.get(seed.envCode);
    if (env === undefined) {
      continue;
    }
    await upsertEnvironmentSystem(
      {
        environmentId: env.id,
        systemCode: seed.systemCode,
        schemaMap: seed.schemaMap
      },
      actor
    );
    logger.info({
      event: "seed.environmentSystem",
      envCode: seed.envCode,
      systemCode: seed.systemCode
    });
  }

  // 4. 数据集（绑定系统与 schemaKey）
  for (const seed of DATASET_SEEDS) {
    const systemId =
      seed.systemCode === undefined
        ? undefined
        : systemIdByCode.get(seed.systemCode);
    await upsertDataset(
      {
        datasetCode: seed.datasetCode,
        datasetName: seed.datasetName,
        sourceSystem: seed.sourceSystem,
        systemId,
        schemaKey: seed.schemaKey,
        sourceSchema: seed.sourceSchema,
        transport: seed.transport,
        extractProfile: seed.extractProfile ?? seed.datasetCode,
        mapping: seed.mapping
      },
      actor
    );
    logger.info({ event: "seed.dataset", datasetCode: seed.datasetCode });
  }

  // 5. 样例数据导入到测试环境
  for (const [datasetCode, fileName] of Object.entries(FIXTURES)) {
    const content = await readFile(join(fixturesDir, fileName), "utf8");
    const result = await importFileBatch({
      datasetCode,
      fileName,
      content,
      environmentId: testEnvironment.id,
      periodStartDate,
      periodEndDate,
      actor
    });
    logger.info({
      event: "seed.import",
      datasetCode,
      batchId: result.batchId,
      status: result.status,
      loaded: result.loaded,
      rejected: result.rejected,
      duplicated: result.duplicated
    });
  }

  // 6. 指标包并执行
  for (const seed of PACK_SEEDS) {
    const { packId } = await ensurePack(seed, pairIdByCode);
    const { run, created } = await createRun({
      packId,
      environmentId: testEnvironment.id,
      periodStartDate,
      periodEndDate,
      runMode: "FULL",
      actor,
      defer: false
    });
    logger.info({
      event: "seed.run",
      packCode: seed.packCode,
      environmentCode: testEnvironment.envCode,
      runId: run.id,
      runStatus: run.runStatus,
      metricTotal: run.metricTotal,
      failMetricCount: run.failMetricCount,
      created
    });
  }

  // 7. 各对账关系的系统间闸门
  for (const seed of PAIR_SEEDS) {
    const pairId = pairIdByCode.get(seed.pairCode);
    try {
      const gate = await getGate("INTERFACE", periodStartDate, periodEndDate, {
        environmentId: testEnvironment.id,
        pairId
      });
      logger.info({
        event: "seed.gate",
        pairCode: seed.pairCode,
        gateStatus: gate.gateStatus,
        blockingMetrics: gate.blockingMetrics
      });
    } catch (error) {
      logger.warn({
        event: "seed.gate.missing",
        pairCode: seed.pairCode,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.info({ event: "seed.done" });
}

main()
  .catch((error: unknown) => {
    logger.error({
      event: "seed.failed",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
