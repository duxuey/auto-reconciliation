import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";

function auditColumns() {
  return {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: varchar("updated_by", { length: 64 }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  };
}

function createdColumns() {
  return {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar("created_by", { length: 64 }).notNull()
  };
}

/**
 * 环境：一套源库连接（新核心同一环境内多个系统共用实例，按 schema 区分）。
 * 密码不落库，只保存环境变量名，运行时解析。
 */
export const environment = pgTable(
  "biz_reconciliation_environment",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    envCode: varchar("env_code", { length: 32 }).notNull(),
    envName: varchar("env_name", { length: 128 }).notNull(),
    dbHost: varchar("db_host", { length: 128 }).notNull(),
    dbPort: integer("db_port").notNull().default(3306),
    dbUser: varchar("db_user", { length: 64 }).notNull(),
    dbPasswordEnvKey: varchar("db_password_env_key", { length: 128 })
      .notNull()
      .default("LEGACY_MYSQL_PASSWORD"),
    defaultDatabase: varchar("default_database", { length: 64 }),
    envStatus: varchar("env_status", { length: 16 }).notNull().default("ACTIVE"),
    isDefault: boolean("is_default").notNull().default(false),
    description: text("description"),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_environment_code").on(
      table.tenantId,
      table.envCode
    ),
    index("idx_biz_reconciliation_environment_status").on(
      table.envStatus,
      table.isDefault
    )
  ]
);

/** 系统：承保/理赔/再保/收付等参与对账的业务系统。 */
export const system = pgTable(
  "biz_reconciliation_system",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    systemCode: varchar("system_code", { length: 32 }).notNull(),
    systemName: varchar("system_name", { length: 128 }).notNull(),
    systemType: varchar("system_type", { length: 32 }).notNull(),
    description: text("description"),
    systemStatus: varchar("system_status", { length: 16 }).notNull().default("ACTIVE"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_system_code").on(
      table.tenantId,
      table.systemCode
    )
  ]
);

/**
 * 环境 × 系统：决定该系统在当前环境使用哪些物理 schema。
 * schema_map 形如 {"DEFAULT":"fpic_clm_db","IFAC":"fpic_ifac_db"}，
 * 数据集通过 schema_key 选择，避免把物理库名写死在 SQL 中。
 */
export const environmentSystem = pgTable(
  "biz_reconciliation_environment_system",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    environmentId: varchar("environment_id", { length: 26 }).notNull(),
    systemId: varchar("system_id", { length: 26 }).notNull(),
    schemaMap: jsonb("schema_map").$type<Record<string, string>>().notNull(),
    connectionLimit: integer("connection_limit").notNull().default(5),
    systemStatus: varchar("system_status", { length: 16 }).notNull().default("ACTIVE"),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_environment_system").on(
      table.tenantId,
      table.environmentId,
      table.systemId
    )
  ]
);

/** 对账关系：预置的系统对，首页按此选择“两组系统核对”。 */
export const systemPair = pgTable(
  "biz_reconciliation_system_pair",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    pairCode: varchar("pair_code", { length: 64 }).notNull(),
    pairName: varchar("pair_name", { length: 128 }).notNull(),
    leftSystemId: varchar("left_system_id", { length: 26 }).notNull(),
    rightSystemId: varchar("right_system_id", { length: 26 }).notNull(),
    pairStatus: varchar("pair_status", { length: 16 }).notNull().default("ACTIVE"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_system_pair_code").on(
      table.tenantId,
      table.pairCode
    ),
    index("idx_biz_reconciliation_system_pair_systems").on(
      table.leftSystemId,
      table.rightSystemId
    )
  ]
);

export const checkPack = pgTable(
  "biz_reconciliation_check_pack",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    packCode: varchar("pack_code", { length: 64 }).notNull(),
    packName: varchar("pack_name", { length: 128 }).notNull(),
    checkStage: varchar("check_stage", { length: 32 }).notNull(),
    pairId: varchar("pair_id", { length: 26 }),
    packStatus: varchar("pack_status", { length: 16 }).notNull().default("DRAFT"),
    currentVersionId: varchar("current_version_id", { length: 26 }),
    description: text("description"),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_check_pack_code").on(table.tenantId, table.packCode),
    index("idx_biz_reconciliation_check_pack_stage").on(table.checkStage, table.packStatus),
    index("idx_biz_reconciliation_check_pack_pair").on(table.pairId, table.packStatus)
  ]
);

export const checkPackVersion = pgTable(
  "biz_reconciliation_check_pack_version",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    packId: varchar("pack_id", { length: 26 }).notNull(),
    versionNo: integer("version_no").notNull(),
    versionStatus: varchar("version_status", { length: 16 }).notNull().default("DRAFT"),
    configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull(),
    configHash: varchar("config_hash", { length: 64 }).notNull(),
    sourceScripts: jsonb("source_scripts").$type<string[]>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: varchar("published_by", { length: 64 }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_check_pack_version").on(table.packId, table.versionNo),
    index("idx_biz_reconciliation_check_pack_version_status").on(
      table.packId,
      table.versionStatus
    )
  ]
);

export const sourceDataset = pgTable(
  "biz_reconciliation_source_dataset",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    datasetCode: varchar("dataset_code", { length: 64 }).notNull(),
    datasetName: varchar("dataset_name", { length: 128 }).notNull(),
    sourceSystem: varchar("source_system", { length: 32 }).notNull(),
    systemId: varchar("system_id", { length: 26 }),
    schemaKey: varchar("schema_key", { length: 32 }).notNull().default("DEFAULT"),
    sourceSchema: varchar("source_schema", { length: 64 }),
    transport: varchar("transport", { length: 16 }).notNull(),
    extractProfile: varchar("extract_profile", { length: 64 }),
    mappingJson: jsonb("mapping_json").$type<Record<string, unknown>>().notNull(),
    mappingHash: varchar("mapping_hash", { length: 64 }).notNull(),
    datasetStatus: varchar("dataset_status", { length: 16 }).notNull().default("ACTIVE"),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_source_dataset").on(table.tenantId, table.datasetCode)
  ]
);

export const importBatch = pgTable(
  "biz_reconciliation_import_batch",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    datasetCode: varchar("dataset_code", { length: 64 }).notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    transport: varchar("transport", { length: 16 }).notNull(),
    fileName: varchar("file_name", { length: 256 }),
    fileHash: varchar("file_hash", { length: 64 }),
    mappingHash: varchar("mapping_hash", { length: 64 }).notNull(),
    syncKey: varchar("sync_key", { length: 128 }),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    rowTotal: integer("row_total").notNull().default(0),
    rowLoaded: integer("row_loaded").notNull().default(0),
    rowRejected: integer("row_rejected").notNull().default(0),
    importStatus: varchar("import_status", { length: 16 }).notNull().default("PENDING"),
    jobId: varchar("job_id", { length: 26 }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_import_batch_file").on(
      table.tenantId,
      table.environmentId,
      table.datasetCode,
      table.fileHash,
      table.mappingHash
    ),
    uniqueIndex("uq_biz_reconciliation_import_batch_sync").on(table.tenantId, table.syncKey),
    index("idx_biz_reconciliation_import_batch_dataset").on(
      table.datasetCode,
      table.createdAt
    ),
    index("idx_biz_reconciliation_import_batch_environment").on(
      table.environmentId,
      table.createdAt
    )
  ]
);

export const importRowError = pgTable(
  "biz_reconciliation_import_row_error",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    importBatchId: varchar("import_batch_id", { length: 26 }).notNull(),
    rowNo: integer("row_no").notNull(),
    errorCode: varchar("error_code", { length: 64 }).notNull(),
    errorMessage: varchar("error_message", { length: 512 }).notNull(),
    rawExt: jsonb("raw_ext").$type<Record<string, unknown>>(),
    ...createdColumns()
  },
  (table) => [
    index("idx_biz_reconciliation_import_row_error_batch").on(table.importBatchId, table.rowNo)
  ]
);

export const stagingRecord = pgTable(
  "biz_reconciliation_staging_record",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    datasetCode: varchar("dataset_code", { length: 64 }).notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    sourceSystem: varchar("source_system", { length: 32 }).notNull(),
    externalId: varchar("external_id", { length: 128 }).notNull(),
    periodCode: varchar("period_code", { length: 8 }),
    businessKeyText: varchar("business_key_text", { length: 512 }).notNull(),
    businessKeyExt: jsonb("business_key_ext").$type<Record<string, string | null>>().notNull(),
    attributesExt: jsonb("attributes_ext").$type<Record<string, string | null>>().notNull(),
    amountsExt: jsonb("amounts_ext").$type<Record<string, string>>().notNull(),
    currency: varchar("currency", { length: 3 }),
    businessDate: date("business_date"),
    recordStatus: varchar("record_status", { length: 32 }),
    sourcePayloadExt: jsonb("source_payload_ext").$type<Record<string, unknown>>(),
    importBatchId: varchar("import_batch_id", { length: 26 }).notNull(),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_staging_record").on(
      table.tenantId,
      table.datasetCode,
      table.externalId,
      table.importBatchId
    ),
    index("idx_biz_reconciliation_staging_record_key").on(
      table.tenantId,
      table.businessKeyText
    ),
    index("idx_biz_reconciliation_staging_record_period").on(
      table.datasetCode,
      table.businessDate
    ),
    index("idx_biz_reconciliation_staging_record_environment").on(
      table.environmentId,
      table.datasetCode,
      table.businessDate
    )
  ]
);

export const checkRun = pgTable(
  "biz_reconciliation_check_run",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    runNo: varchar("run_no", { length: 32 }).notNull(),
    packId: varchar("pack_id", { length: 26 }).notNull(),
    packVersionId: varchar("pack_version_id", { length: 26 }).notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    pairId: varchar("pair_id", { length: 26 }),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    runMode: varchar("run_mode", { length: 16 }).notNull(),
    runStatus: varchar("run_status", { length: 16 }).notNull().default("PENDING"),
    inputFingerprint: varchar("input_fingerprint", { length: 64 }).notNull(),
    inputManifestExt: jsonb("input_manifest_ext").$type<Record<string, unknown>>().notNull(),
    metricTotal: integer("metric_total").notNull().default(0),
    failMetricCount: integer("fail_metric_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 64 }),
    failureMessage: varchar("failure_message", { length: 512 }),
    jobId: varchar("job_id", { length: 26 }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_check_run_no").on(table.tenantId, table.runNo),
    uniqueIndex("uq_biz_reconciliation_check_run_fingerprint").on(
      table.tenantId,
      table.inputFingerprint
    ),
    index("idx_biz_reconciliation_check_run_pack").on(
      table.packId,
      table.periodEndDate
    ),
    index("idx_biz_reconciliation_check_run_scope").on(
      table.environmentId,
      table.pairId,
      table.periodEndDate
    ),
    index("idx_biz_reconciliation_check_run_status").on(table.runStatus)
  ]
);

export const checkMetricResult = pgTable(
  "biz_reconciliation_check_metric_result",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    runId: varchar("run_id", { length: 26 }).notNull(),
    comparisonCode: varchar("comparison_code", { length: 64 }).notNull(),
    metricCode: varchar("metric_code", { length: 8 }).notNull(),
    metricName: varchar("metric_name", { length: 128 }).notNull(),
    metricType: varchar("metric_type", { length: 32 }).notNull(),
    checkResult: varchar("check_result", { length: 8 }).notNull(),
    totalCount: bigint("total_count", { mode: "number" }).notNull(),
    failCount: bigint("fail_count", { mode: "number" }).notNull(),
    detailExt: jsonb("detail_ext").$type<Record<string, unknown>>(),
    ...createdColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_check_metric_result").on(
      table.runId,
      table.comparisonCode,
      table.metricCode
    ),
    index("idx_biz_reconciliation_check_metric_result_code").on(
      table.runId,
      table.metricCode
    )
  ]
);

export const checkDiff = pgTable(
  "biz_reconciliation_check_diff",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    runId: varchar("run_id", { length: 26 }).notNull(),
    comparisonCode: varchar("comparison_code", { length: 64 }).notNull(),
    metricCode: varchar("metric_code", { length: 8 }).notNull(),
    diffType: varchar("diff_type", { length: 32 }).notNull(),
    businessKeyText: varchar("business_key_text", { length: 512 }).notNull(),
    businessKeyExt: jsonb("business_key_ext").$type<Record<string, string | null>>().notNull(),
    fieldCode: varchar("field_code", { length: 64 }),
    leftValue: numeric("left_value", { precision: 19, scale: 4 }),
    rightValue: numeric("right_value", { precision: 19, scale: 4 }),
    diffValue: numeric("diff_value", { precision: 19, scale: 4 }),
    leftText: varchar("left_text", { length: 512 }),
    rightText: varchar("right_text", { length: 512 }),
    currency: varchar("currency", { length: 3 }),
    diffStatus: varchar("diff_status", { length: 16 }).notNull().default("OPEN"),
    assignee: varchar("assignee", { length: 64 }),
    resolutionType: varchar("resolution_type", { length: 32 }),
    resolutionNote: text("resolution_note"),
    version: integer("version").notNull().default(1),
    ...auditColumns()
  },
  (table) => [
    index("idx_biz_reconciliation_check_diff_run").on(table.runId, table.metricCode),
    index("idx_biz_reconciliation_check_diff_status").on(
      table.tenantId,
      table.diffStatus,
      table.createdAt
    ),
    index("idx_biz_reconciliation_check_diff_key").on(table.tenantId, table.businessKeyText)
  ]
);

export const checkDiffLog = pgTable(
  "biz_reconciliation_check_diff_log",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    diffId: varchar("diff_id", { length: 26 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    fromStatus: varchar("from_status", { length: 16 }),
    toStatus: varchar("to_status", { length: 16 }),
    note: text("note"),
    actor: varchar("actor", { length: 64 }).notNull(),
    ...createdColumns()
  },
  (table) => [index("idx_biz_reconciliation_check_diff_log").on(table.diffId, table.createdAt)]
);

export const adjustment = pgTable(
  "biz_reconciliation_adjustment",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    diffId: varchar("diff_id", { length: 26 }).notNull(),
    runId: varchar("run_id", { length: 26 }).notNull(),
    adjustmentNo: varchar("adjustment_no", { length: 32 }).notNull(),
    adjustmentType: varchar("adjustment_type", { length: 32 }).notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    reason: text("reason").notNull(),
    adjustmentStatus: varchar("adjustment_status", { length: 16 }).notNull().default("DRAFT"),
    version: integer("version").notNull().default(1),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_adjustment_no").on(
      table.tenantId,
      table.adjustmentNo
    ),
    index("idx_biz_reconciliation_adjustment_diff").on(table.diffId),
    index("idx_biz_reconciliation_adjustment_status").on(table.adjustmentStatus)
  ]
);

export const checkGate = pgTable(
  "biz_reconciliation_check_gate",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    checkStage: varchar("check_stage", { length: 32 }).notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    pairId: varchar("pair_id", { length: 26 }),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    gateStatus: varchar("gate_status", { length: 16 }).notNull().default("PENDING"),
    runIdsExt: jsonb("run_ids_ext").$type<string[]>().notNull(),
    blockingMetricsExt: jsonb("blocking_metrics_ext")
      .$type<Array<{ packCode: string; metricCode: string; metricName: string; failCount: number }>>()
      .notNull(),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    signedOffBy: varchar("signed_off_by", { length: 64 }),
    version: integer("version").notNull().default(1),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_check_gate").on(
      table.tenantId,
      table.checkStage,
      table.environmentId,
      table.pairId,
      table.periodStartDate,
      table.periodEndDate
    ),
    index("idx_biz_reconciliation_check_gate_status").on(table.gateStatus)
  ]
);

/**
 * 每日自动对账配置：单租户一行。
 * 密钥只存环境变量名，实际值由部署环境注入，不落库、不回传。
 */
export const automationConfig = pgTable(
  "biz_reconciliation_automation_config",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    runTime: varchar("run_time", { length: 5 }).notNull().default("08:30"),
    notifyChannel: varchar("notify_channel", { length: 16 }).notNull().default("WEBHOOK"),
    environmentId: varchar("environment_id", { length: 26 }).notNull(),
    webhookUrlEnvKey: varchar("webhook_url_env_key", { length: 128 })
      .notNull()
      .default("WECOM_WEBHOOK_URL"),
    appCorpId: varchar("app_corp_id", { length: 128 }),
    appAgentId: varchar("app_agent_id", { length: 64 }),
    appSecretEnvKey: varchar("app_secret_env_key", { length: 128 })
      .notNull()
      .default("WECOM_APP_SECRET"),
    toUser: varchar("to_user", { length: 1024 }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_automation_config_tenant").on(table.tenantId)
  ]
);

/** 自动/手动触发的一次对账执行记录。 */
export const automationRun = pgTable(
  "biz_reconciliation_automation_run",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    runKey: varchar("run_key", { length: 128 }).notNull(),
    triggerType: varchar("trigger_type", { length: 16 }).notNull(),
    businessDate: date("business_date").notNull(),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    runStatus: varchar("run_status", { length: 16 }).notNull().default("PENDING"),
    pairCount: integer("pair_count").notNull().default(0),
    pairExecutedCount: integer("pair_executed_count").notNull().default(0),
    pairNoDataCount: integer("pair_no_data_count").notNull().default(0),
    pairFailedCount: integer("pair_failed_count").notNull().default(0),
    batchCount: integer("batch_count").notNull().default(0),
    batchReusedCount: integer("batch_reused_count").notNull().default(0),
    batchSucceededCount: integer("batch_succeeded_count").notNull().default(0),
    batchFailedCount: integer("batch_failed_count").notNull().default(0),
    metricTotal: integer("metric_total").notNull().default(0),
    failMetricCount: integer("fail_metric_count").notNull().default(0),
    diffCount: integer("diff_count").notNull().default(0),
    notifyEnabled: boolean("notify_enabled").notNull().default(true),
    notifyStatus: varchar("notify_status", { length: 16 }).notNull().default("PENDING"),
    notifyChannel: varchar("notify_channel", { length: 16 }),
    notifyError: varchar("notify_error", { length: 512 }),
    summaryExt: jsonb("summary_ext").$type<Record<string, unknown>>(),
    messageText: text("message_text"),
    errorMessage: varchar("error_message", { length: 512 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_automation_run_key").on(
      table.tenantId,
      table.runKey
    ),
    index("idx_biz_reconciliation_automation_run_created").on(
      table.tenantId,
      table.createdAt
    ),
    index("idx_biz_reconciliation_automation_run_status").on(table.runStatus),
    index("idx_biz_reconciliation_automation_run_period").on(
      table.periodStartDate,
      table.periodEndDate
    )
  ]
);

export const job = pgTable(
  "biz_reconciliation_job",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    jobType: varchar("job_type", { length: 16 }).notNull(),
    jobStatus: varchar("job_status", { length: 16 }).notNull().default("QUEUED"),
    refType: varchar("ref_type", { length: 32 }),
    refId: varchar("ref_id", { length: 64 }),
    progressPercent: integer("progress_percent").notNull().default(0),
    resultExt: jsonb("result_ext").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: varchar("error_message", { length: 512 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("uq_biz_reconciliation_job_idempotency").on(
      table.tenantId,
      table.idempotencyKey
    ),
    index("idx_biz_reconciliation_job_status").on(table.jobStatus),
    index("idx_biz_reconciliation_job_ref").on(table.refType, table.refId)
  ]
);

export const schema = {
  environment,
  system,
  environmentSystem,
  systemPair,
  checkPack,
  checkPackVersion,
  sourceDataset,
  importBatch,
  importRowError,
  stagingRecord,
  checkRun,
  checkMetricResult,
  checkDiff,
  checkDiffLog,
  adjustment,
  checkGate,
  automationConfig,
  automationRun,
  job
};
