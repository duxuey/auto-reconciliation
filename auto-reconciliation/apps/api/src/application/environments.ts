import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ulid } from "ulid";
import { createLegacyPool, pingLegacy } from "@adapter/legacy-mysql";
import {
  config,
  isLegacyMysqlConfigured,
  isPasswordEnvKey,
  readSecret
} from "../config.js";
import { db } from "../db/client.js";
import {
  automationConfig,
  automationRun,
  checkPack,
  checkRun,
  environment,
  environmentSystem,
  importBatch,
  sourceDataset,
  system,
  systemPair
} from "../db/schema.js";
import { AppError } from "../domain/errors.js";
import { logger } from "../infra/logger.js";
import { requireRow } from "../infra/require.js";

export type EnvironmentRow = typeof environment.$inferSelect;
export type SystemRow = typeof system.$inferSelect;
export type EnvironmentSystemRow = typeof environmentSystem.$inferSelect;
export type SystemPairRow = typeof systemPair.$inferSelect;
export type DatasetRow = typeof sourceDataset.$inferSelect;

export interface CreateEnvironmentInput {
  envCode: string;
  envName: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPasswordEnvKey: string;
  defaultDatabase?: string;
  isDefault?: boolean;
  description?: string;
}

export interface UpsertEnvironmentSystemInput {
  environmentId: string;
  systemCode: string;
  schemaMap: Record<string, string>;
  connectionLimit?: number;
}

export interface PairView {
  id: string;
  pairCode: string;
  pairName: string;
  leftSystemCode: string;
  leftSystemName: string;
  rightSystemCode: string;
  rightSystemName: string;
  pairStatus: string;
  description: string | null;
  sortOrder: number;
  packCount: number;
}

export interface ResolvedDatasource {
  environmentId: string;
  environmentCode: string;
  systemId: string | null;
  schemaName: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

function tenantId(): string {
  return config.TENANT_ID;
}

function assertSchemaName(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
      `schema 名称非法: ${value}`
    );
  }
  return value;
}

export async function listEnvironments(): Promise<EnvironmentRow[]> {
  return db
    .select()
    .from(environment)
    .where(and(eq(environment.tenantId, tenantId()), isNull(environment.deletedAt)))
    .orderBy(asc(environment.envCode));
}

export async function getEnvironmentById(id: string): Promise<EnvironmentRow> {
  const rows = await db
    .select()
    .from(environment)
    .where(
      and(
        eq(environment.tenantId, tenantId()),
        eq(environment.id, id),
        isNull(environment.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
      `环境 ${id} 不存在`
    );
  }
  return row;
}

export async function getEnvironmentByCode(envCode: string): Promise<EnvironmentRow> {
  const rows = await db
    .select()
    .from(environment)
    .where(
      and(
        eq(environment.tenantId, tenantId()),
        eq(environment.envCode, envCode),
        isNull(environment.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
      `环境 ${envCode} 不存在`
    );
  }
  return row;
}

/** 首页/接口未显式传环境时，使用默认环境；再退回 DEFAULT_ENVIRONMENT_CODE。 */
export async function resolveEnvironment(input?: {
  environmentId?: string;
  environmentCode?: string;
}): Promise<EnvironmentRow> {
  if (input?.environmentId !== undefined && input.environmentId !== "") {
    return getEnvironmentById(input.environmentId);
  }
  if (input?.environmentCode !== undefined && input.environmentCode !== "") {
    return getEnvironmentByCode(input.environmentCode);
  }
  const preferred = await db
    .select()
    .from(environment)
    .where(
      and(
        eq(environment.tenantId, tenantId()),
        eq(environment.envStatus, "ACTIVE"),
        eq(environment.isDefault, true),
        isNull(environment.deletedAt)
      )
    )
    .limit(1);
  if (preferred[0] !== undefined) {
    return preferred[0];
  }
  const fallback = await db
    .select()
    .from(environment)
    .where(
      and(
        eq(environment.tenantId, tenantId()),
        eq(environment.envCode, config.DEFAULT_ENVIRONMENT_CODE),
        isNull(environment.deletedAt)
      )
    )
    .limit(1);
  if (fallback[0] !== undefined) {
    return fallback[0];
  }
  throw new AppError(
    "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
    `未配置默认环境（期望 ${config.DEFAULT_ENVIRONMENT_CODE}）`
  );
}

export async function createEnvironment(
  input: CreateEnvironmentInput,
  actor: string
): Promise<EnvironmentRow> {
  const existing = await db
    .select()
    .from(environment)
    .where(
      and(
        eq(environment.tenantId, tenantId()),
        eq(environment.envCode, input.envCode)
      )
    )
    .limit(1);
  const found = existing[0];
  if (found !== undefined && found.deletedAt === null) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT",
      `环境编码 ${input.envCode} 已存在`
    );
  }
  return db.transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx
        .update(environment)
        .set({ isDefault: false, updatedBy: actor, updatedAt: sql`now()` })
        .where(
          and(eq(environment.tenantId, tenantId()), eq(environment.isDefault, true))
        );
    }
    if (found !== undefined) {
      // 同一编码的环境曾被删除：复用原行恢复，避免与唯一索引冲突。
      const [restored] = await tx
        .update(environment)
        .set({
          envName: input.envName,
          dbHost: input.dbHost,
          dbPort: input.dbPort,
          dbUser: input.dbUser,
          dbPasswordEnvKey: input.dbPasswordEnvKey,
          defaultDatabase: input.defaultDatabase ?? null,
          envStatus: "ACTIVE",
          isDefault: input.isDefault ?? false,
          description: input.description ?? null,
          deletedAt: null,
          updatedBy: actor,
          updatedAt: sql`now()`
        })
        .where(
          and(eq(environment.tenantId, tenantId()), eq(environment.id, found.id))
        )
        .returning();
      return requireRow(restored, "环境恢复失败");
    }
    const [created] = await tx
      .insert(environment)
      .values({
        id: ulid(),
        tenantId: tenantId(),
        envCode: input.envCode,
        envName: input.envName,
        dbHost: input.dbHost,
        dbPort: input.dbPort,
        dbUser: input.dbUser,
        dbPasswordEnvKey: input.dbPasswordEnvKey,
        defaultDatabase: input.defaultDatabase ?? null,
        envStatus: "ACTIVE",
        isDefault: input.isDefault ?? false,
        description: input.description ?? null,
        createdBy: actor,
        updatedBy: actor
      })
      .returning();
    return requireRow(created, "环境创建失败");
  });
}

export async function updateEnvironment(
  id: string,
  input: Partial<CreateEnvironmentInput> & { envStatus?: string },
  actor: string
): Promise<EnvironmentRow> {
  await getEnvironmentById(id);
  return db.transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx
        .update(environment)
        .set({ isDefault: false, updatedBy: actor, updatedAt: sql`now()` })
        .where(
          and(eq(environment.tenantId, tenantId()), eq(environment.isDefault, true))
        );
    }
    const [updated] = await tx
      .update(environment)
      .set({
        ...(input.envName === undefined ? {} : { envName: input.envName }),
        ...(input.dbHost === undefined ? {} : { dbHost: input.dbHost }),
        ...(input.dbPort === undefined ? {} : { dbPort: input.dbPort }),
        ...(input.dbUser === undefined ? {} : { dbUser: input.dbUser }),
        ...(input.dbPasswordEnvKey === undefined
          ? {}
          : { dbPasswordEnvKey: input.dbPasswordEnvKey }),
        ...(input.defaultDatabase === undefined
          ? {}
          : { defaultDatabase: input.defaultDatabase }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        ...(input.envStatus === undefined ? {} : { envStatus: input.envStatus }),
        ...(input.description === undefined ? {} : { description: input.description }),
        updatedBy: actor,
        updatedAt: sql`now()`
      })
      .where(
        and(eq(environment.tenantId, tenantId()), eq(environment.id, id))
      )
      .returning();
    return requireRow(updated, "环境更新失败");
  });
}

async function hasEnvironmentHistory(environmentId: string): Promise<boolean> {
  const [batch] = await db
    .select({ id: importBatch.id })
    .from(importBatch)
    .where(
      and(
        eq(importBatch.tenantId, tenantId()),
        eq(importBatch.environmentId, environmentId)
      )
    )
    .limit(1);
  if (batch !== undefined) {
    return true;
  }
  const [run] = await db
    .select({ id: checkRun.id })
    .from(checkRun)
    .where(
      and(eq(checkRun.tenantId, tenantId()), eq(checkRun.environmentId, environmentId))
    )
    .limit(1);
  if (run !== undefined) {
    return true;
  }
  const [auto] = await db
    .select({ id: automationRun.id })
    .from(automationRun)
    .where(
      and(
        eq(automationRun.tenantId, tenantId()),
        eq(automationRun.environmentId, environmentId)
      )
    )
    .limit(1);
  return auto !== undefined;
}

/**
 * 软删除环境：
 * - 默认环境、最后一个环境、自动对账正在使用的环境不允许删除；
 * - 存在批次/执行历史时保留审计数据，改用停用；
 * - 同步软删除该环境的系统 schema 配置。
 */
export async function deleteEnvironment(
  id: string,
  actor: string
): Promise<{ ok: true }> {
  const env = await getEnvironmentById(id);
  if (env.isDefault) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT",
      `默认环境 ${env.envCode} 不能删除，请先将其他环境设为默认`
    );
  }
  const others = await db
    .select({ id: environment.id })
    .from(environment)
    .where(
      and(
        eq(environment.tenantId, tenantId()),
        isNull(environment.deletedAt),
        ne(environment.id, id)
      )
    )
    .limit(1);
  if (others.length === 0) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT",
      "至少需要保留一个环境"
    );
  }
  const [automation] = await db
    .select({ id: automationConfig.id })
    .from(automationConfig)
    .where(
      and(
        eq(automationConfig.tenantId, tenantId()),
        eq(automationConfig.environmentId, id)
      )
    )
    .limit(1);
  if (automation !== undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT",
      "自动对账正在使用该环境，请先在自动对账中切换环境"
    );
  }
  if (await hasEnvironmentHistory(id)) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT",
      `环境 ${env.envCode} 已有批次或执行记录，不能删除；如不再使用请改为停用`
    );
  }
  await db.transaction(async (tx) => {
    await tx
      .update(environmentSystem)
      .set({ deletedAt: sql`now()`, updatedBy: actor, updatedAt: sql`now()` })
      .where(
        and(
          eq(environmentSystem.tenantId, tenantId()),
          eq(environmentSystem.environmentId, id),
          isNull(environmentSystem.deletedAt)
        )
      );
    await tx
      .update(environment)
      .set({ deletedAt: sql`now()`, updatedBy: actor, updatedAt: sql`now()` })
      .where(and(eq(environment.tenantId, tenantId()), eq(environment.id, id)));
  });
  return { ok: true };
}

export async function listSystems(): Promise<SystemRow[]> {
  return db
    .select()
    .from(system)
    .where(and(eq(system.tenantId, tenantId()), isNull(system.deletedAt)))
    .orderBy(asc(system.sortOrder), asc(system.systemCode));
}

export async function getSystemByCode(systemCode: string): Promise<SystemRow> {
  const rows = await db
    .select()
    .from(system)
    .where(
      and(
        eq(system.tenantId, tenantId()),
        eq(system.systemCode, systemCode),
        isNull(system.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_SYSTEM_NOT_FOUND",
      `系统 ${systemCode} 不存在`
    );
  }
  return row;
}

export async function listEnvironmentSystems(environmentId: string) {
  await getEnvironmentById(environmentId);
  return db
    .select({
      id: environmentSystem.id,
      environmentId: environmentSystem.environmentId,
      systemId: environmentSystem.systemId,
      systemCode: system.systemCode,
      systemName: system.systemName,
      systemType: system.systemType,
      schemaMap: environmentSystem.schemaMap,
      connectionLimit: environmentSystem.connectionLimit,
      systemStatus: environmentSystem.systemStatus
    })
    .from(environmentSystem)
    .innerJoin(system, eq(environmentSystem.systemId, system.id))
    .where(
      and(
        eq(environmentSystem.tenantId, tenantId()),
        eq(environmentSystem.environmentId, environmentId),
        isNull(environmentSystem.deletedAt)
      )
    )
    .orderBy(asc(system.sortOrder), asc(system.systemCode));
}

export async function upsertEnvironmentSystem(
  input: UpsertEnvironmentSystemInput,
  actor: string
): Promise<EnvironmentSystemRow> {
  await getEnvironmentById(input.environmentId);
  const target = await getSystemByCode(input.systemCode);
  const schemaMap = Object.fromEntries(
    Object.entries(input.schemaMap).map(([key, value]) => [
      key,
      assertSchemaName(value)
    ])
  );
  const existing = await db
    .select()
    .from(environmentSystem)
    .where(
      and(
        eq(environmentSystem.tenantId, tenantId()),
        eq(environmentSystem.environmentId, input.environmentId),
        eq(environmentSystem.systemId, target.id)
      )
    )
    .limit(1);
  if (existing[0] === undefined) {
    const [created] = await db
      .insert(environmentSystem)
      .values({
        id: ulid(),
        tenantId: tenantId(),
        environmentId: input.environmentId,
        systemId: target.id,
        schemaMap,
        connectionLimit: input.connectionLimit ?? 5,
        systemStatus: "ACTIVE",
        createdBy: actor,
        updatedBy: actor
      })
      .returning();
    return requireRow(created, "环境系统配置创建失败");
  }
  const [updated] = await db
    .update(environmentSystem)
    .set({
      schemaMap,
      connectionLimit: input.connectionLimit ?? 5,
      systemStatus: "ACTIVE",
      // 已软删除的同一环境×系统配置在重新保存时恢复，避免与唯一索引冲突。
      deletedAt: null,
      updatedBy: actor,
      updatedAt: sql`now()`
    })
    .where(
      and(
        eq(environmentSystem.tenantId, tenantId()),
        eq(environmentSystem.id, existing[0].id)
      )
    )
    .returning();
  return requireRow(updated, "环境系统配置更新失败");
}

/** 软删除环境×系统 schema 配置；再次保存同一系统时会恢复该行。 */
export async function deleteEnvironmentSystem(
  id: string,
  actor: string
): Promise<{ ok: true }> {
  const rows = await db
    .select({ id: environmentSystem.id })
    .from(environmentSystem)
    .where(
      and(
        eq(environmentSystem.tenantId, tenantId()),
        eq(environmentSystem.id, id),
        isNull(environmentSystem.deletedAt)
      )
    )
    .limit(1);
  if (rows[0] === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
      `环境系统配置 ${id} 不存在`
    );
  }
  await db
    .update(environmentSystem)
    .set({ deletedAt: sql`now()`, updatedBy: actor, updatedAt: sql`now()` })
    .where(
      and(
        eq(environmentSystem.tenantId, tenantId()),
        eq(environmentSystem.id, id)
      )
    );
  return { ok: true };
}

export async function listPairs(): Promise<SystemPairRow[]> {
  return db
    .select()
    .from(systemPair)
    .where(and(eq(systemPair.tenantId, tenantId()), isNull(systemPair.deletedAt)))
    .orderBy(asc(systemPair.sortOrder), asc(systemPair.pairCode));
}

export async function listPairsView(): Promise<PairView[]> {
  const left = alias(system, "left_system");
  const right = alias(system, "right_system");
  const rows = await db
    .select({
      pair: systemPair,
      leftSystemCode: left.systemCode,
      leftSystemName: left.systemName,
      rightSystemCode: right.systemCode,
      rightSystemName: right.systemName
    })
    .from(systemPair)
    .innerJoin(left, eq(systemPair.leftSystemId, left.id))
    .innerJoin(right, eq(systemPair.rightSystemId, right.id))
    .where(
      and(eq(systemPair.tenantId, tenantId()), isNull(systemPair.deletedAt))
    )
    .orderBy(asc(systemPair.sortOrder), asc(systemPair.pairCode));

  const packCounts = await db
    .select({ pairId: checkPack.pairId, count: sql<number>`count(*)::int` })
    .from(checkPack)
    .where(
      and(
        eq(checkPack.tenantId, tenantId()),
        isNull(checkPack.deletedAt),
        eq(checkPack.packStatus, "ACTIVE")
      )
    )
    .groupBy(checkPack.pairId);
  const countByPair = new Map(
    packCounts.map((row) => [row.pairId ?? "", row.count])
  );

  return rows.map((row) => ({
    id: row.pair.id,
    pairCode: row.pair.pairCode,
    pairName: row.pair.pairName,
    leftSystemCode: row.leftSystemCode,
    leftSystemName: row.leftSystemName,
    rightSystemCode: row.rightSystemCode,
    rightSystemName: row.rightSystemName,
    pairStatus: row.pair.pairStatus,
    description: row.pair.description,
    sortOrder: row.pair.sortOrder,
    packCount: countByPair.get(row.pair.id) ?? 0
  }));
}

export async function getPairById(id: string): Promise<SystemPairRow> {
  const rows = await db
    .select()
    .from(systemPair)
    .where(
      and(
        eq(systemPair.tenantId, tenantId()),
        eq(systemPair.id, id),
        isNull(systemPair.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_PAIR_NOT_FOUND",
      `对账关系 ${id} 不存在`
    );
  }
  return row;
}

export async function getPairByCode(pairCode: string): Promise<SystemPairRow> {
  const rows = await db
    .select()
    .from(systemPair)
    .where(
      and(
        eq(systemPair.tenantId, tenantId()),
        eq(systemPair.pairCode, pairCode),
        isNull(systemPair.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_PAIR_NOT_FOUND",
      `对账关系 ${pairCode} 不存在`
    );
  }
  return row;
}

export interface ResolveDatasetDatasourceOptions {
  environmentId?: string;
  environmentCode?: string;
  /**
   * 直连执行时使用严格模式：
   * - 禁止回退 LEGACY_MYSQL_*，避免 PROD 静默读本地库；
   * - 必须存在 ACTIVE 的环境×系统 schema 映射；
   * - schemaKey 必须命中 schemaMap[schemaKey] 或 DEFAULT。
   */
  strict?: boolean;
  /** 已解析的环境，供就绪检查复用，避免 N+1 查询 */
  environment?: EnvironmentRow;
}

/** 数据源指纹：区分不同实例/schema 的批次，避免复用错误环境的源数据 */
export function datasourceFingerprint(datasource: ResolvedDatasource): string {
  return [
    datasource.environmentId,
    datasource.systemId ?? "",
    `${datasource.host}:${datasource.port}`,
    datasource.database,
    datasource.schemaName
  ].join("|");
}

/**
 * 解析数据集在当前环境下应连接的实例与 schema。
 * 新模型：数据集挂 systemId + schemaKey，环境×系统提供 schemaMap。
 * strict=false 时兼容旧配置：未登记 systemId 时回退到 LEGACY_MYSQL_* 与 dataset.sourceSchema。
 * strict=true 时只允许显式环境×系统映射。
 */
export async function resolveDatasetDatasource(
  dataset: DatasetRow,
  options?: ResolveDatasetDatasourceOptions
): Promise<ResolvedDatasource> {
  const strict = options?.strict === true;
  let env: EnvironmentRow | null;
  if (options?.environment !== undefined) {
    env = options.environment;
  } else {
    try {
      env = await resolveEnvironment({
        environmentId: options?.environmentId,
        environmentCode: options?.environmentCode
      });
    } catch (error) {
      if (strict) {
        throw error;
      }
      env = null;
    }
  }

  if (strict) {
    if (env === null) {
      throw new AppError(
        "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
        `环境 ${options?.environmentId ?? options?.environmentCode ?? ""} 不存在`
      );
    }
    if (env.envStatus !== "ACTIVE") {
      throw new AppError(
        "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
        `环境 ${env.envCode} 未启用，无法直连源库`
      );
    }
    if (dataset.systemId === null) {
      throw new AppError(
        "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
        `数据集 ${dataset.datasetCode} 未绑定来源系统，无法直连源库`
      );
    }
  }

  if (env !== null && dataset.systemId !== null) {
    const envSystems = await db
      .select()
      .from(environmentSystem)
      .where(
        and(
          eq(environmentSystem.tenantId, tenantId()),
          eq(environmentSystem.environmentId, env.id),
          eq(environmentSystem.systemId, dataset.systemId),
          eq(environmentSystem.systemStatus, "ACTIVE"),
          isNull(environmentSystem.deletedAt)
        )
      )
      .limit(1);
    const envSystem = envSystems[0];
    if (envSystem === undefined && strict) {
      throw new AppError(
        "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
        `环境 ${env.envCode} 未为数据集 ${dataset.datasetCode} 所属系统配置 schema`
      );
    }
    if (envSystem !== undefined) {
      const schemaName = strict
        ? (envSystem.schemaMap[dataset.schemaKey] ?? envSystem.schemaMap.DEFAULT)
        : (envSystem.schemaMap[dataset.schemaKey] ??
          envSystem.schemaMap.DEFAULT ??
          Object.values(envSystem.schemaMap)[0]);
      if (schemaName === undefined) {
        throw new AppError(
          "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
          strict
            ? `环境 ${env.envCode} 未为数据集 ${dataset.datasetCode} 配置 schemaKey ${dataset.schemaKey}`
            : `环境 ${env.envCode} 未为系统配置 schema（数据集 ${dataset.datasetCode}）`
        );
      }
      if (strict) {
        if (env.dbHost.trim() === "" || env.dbUser.trim() === "") {
          throw new AppError(
            "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
            `环境 ${env.envCode} 未配置数据库 host/user`
          );
        }
        if (!isPasswordEnvKey(env.dbPasswordEnvKey)) {
          throw new AppError(
            "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
            `环境 ${env.envCode} 的「密码环境变量名」不是合法的环境变量名，请在环境配置中修正`
          );
        }
        if (readSecret(env.dbPasswordEnvKey) === undefined) {
          throw new AppError(
            "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
            `环境 ${env.envCode} 的密码环境变量 ${env.dbPasswordEnvKey} 未配置`
          );
        }
      }
      return {
        environmentId: env.id,
        environmentCode: env.envCode,
        systemId: dataset.systemId,
        schemaName: assertSchemaName(schemaName),
        host: env.dbHost,
        port: env.dbPort,
        user: env.dbUser,
        password: readSecret(env.dbPasswordEnvKey) ?? "",
        database: env.defaultDatabase ?? "",
        connectionLimit: envSystem.connectionLimit
      };
    }
  }

  if (strict) {
    throw new AppError(
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
      `环境 ${env?.envCode ?? ""} 未配置数据集 ${dataset.datasetCode} 的数据源`
    );
  }

  if (isLegacyMysqlConfigured()) {
    return {
      environmentId: env?.id ?? "",
      environmentCode: env?.envCode ?? "LEGACY",
      systemId: dataset.systemId,
      schemaName: assertSchemaName(dataset.sourceSchema ?? "fpic_ri_acc_db"),
      host: config.LEGACY_MYSQL_HOST ?? "127.0.0.1",
      port: config.LEGACY_MYSQL_PORT ?? 3306,
      user: config.LEGACY_MYSQL_USER ?? "",
      password: config.LEGACY_MYSQL_PASSWORD ?? "",
      database: config.LEGACY_MYSQL_DATABASE ?? "",
      connectionLimit: 5
    };
  }

  throw new AppError(
    "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE",
    `环境 ${options?.environmentId ?? ""} 未配置数据集 ${dataset.datasetCode} 的数据源`
  );
}

function connectionErrorCode(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  return "";
}

/**
 * 测试连接只返回可操作提示，不包含 host、账号、密码或驱动原始报错。
 */
export function describeConnectionError(error: unknown): string {
  switch (connectionErrorCode(error)) {
    case "PROTOCOL_CONNECTION_LOST":
    case "ECONNRESET":
    case "EPIPE":
      return "连接被服务器关闭（未完成 MySQL 握手）。请确认数据库防火墙/白名单允许本机 IP 访问该端口，或该地址是否需要通过 VPN/跳板机连接。";
    case "ER_ACCESS_DENIED_ERROR":
      return "账号或密码错误，或该账号不允许从当前 IP 登录。";
    case "ER_HOST_IS_BLOCKED":
      return "当前主机因多次连接失败被数据库拒绝，请联系 DBA 执行 FLUSH HOSTS。";
    case "ER_BAD_DB_ERROR":
      return "默认数据库不存在，请检查环境配置中的默认库名。";
    case "ER_CON_COUNT_ERROR":
      return "数据库连接数已满，请稍后重试或联系 DBA。";
    case "ETIMEDOUT":
      return "连接超时：请检查网络、防火墙与端口是否可达。";
    case "ECONNREFUSED":
      return "连接被拒绝：端口未开放或数据库服务未启动。";
    case "ENOTFOUND":
      return "数据库主机名无法解析。";
    case "HANDSHAKE_SSL_ERROR":
      return "TLS 握手失败：请确认数据库 SSL 配置。";
    default: {
      const code = connectionErrorCode(error);
      return code === "" ? "连接失败，请检查环境配置与网络。" : `连接失败（错误类型 ${code}）。`;
    }
  }
}

export async function testEnvironmentConnection(
  environmentId: string
): Promise<{ ok: boolean; message: string }> {
  const env = await getEnvironmentById(environmentId);
  if (!isPasswordEnvKey(env.dbPasswordEnvKey)) {
    return {
      ok: false,
      message: `环境 ${env.envCode} 的「密码环境变量名」不是合法的环境变量名，可能填入了密码本身。请编辑该环境，改为环境变量名（如 SIT_MYSQL_PASSWORD），并在 .env 中设置该变量后重启 API。`
    };
  }
  const password = readSecret(env.dbPasswordEnvKey);
  if (password === undefined) {
    return {
      ok: false,
      message: `环境 ${env.envCode} 的密码环境变量 ${env.dbPasswordEnvKey} 未配置。请在 .env 中设置该变量（如 ${env.dbPasswordEnvKey}=密码）后重启 API。`
    };
  }
  const pool = createLegacyPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password,
    database: env.defaultDatabase ?? "",
    connectionLimit: 1
  });
  try {
    await pingLegacy(pool);
    return { ok: true, message: `环境 ${env.envCode} 连接成功` };
  } catch (error) {
    logger.warn({
      event: "environment.connection.failed",
      environmentCode: env.envCode,
      errorCode: connectionErrorCode(error)
    });
    return { ok: false, message: describeConnectionError(error) };
  } finally {
    await pool.end();
  }
}
