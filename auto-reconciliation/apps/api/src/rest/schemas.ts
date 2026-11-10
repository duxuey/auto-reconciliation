import { z } from "zod";
import { businessDateSchema, moneyStringSchema } from "@shared/schemas";
import { CHECK_STAGES, METRIC_TYPES } from "@infra/biz-reconciliation-engine";
import { PASSWORD_ENV_KEY_PATTERN } from "../config.js";

export const periodSchema = z.object({
  periodStartDate: businessDateSchema,
  periodEndDate: businessDateSchema
});

export const scopeQuerySchema = z.object({
  environmentId: z.string().length(26).optional(),
  pairId: z.string().length(26).optional()
});

export const overviewQuerySchema = scopeQuerySchema;

export const environmentCreateSchema = z.object({
  envCode: z.string().min(1).max(32),
  envName: z.string().min(1).max(128),
  dbHost: z.string().min(1).max(128),
  dbPort: z.coerce.number().int().min(1).max(65535).default(3306),
  dbUser: z.string().min(1).max(64),
  // 只存环境变量名，不存密码本身；形如 SIT_MYSQL_PASSWORD。
  dbPasswordEnvKey: z
    .string()
    .min(1)
    .max(128)
    .regex(
      PASSWORD_ENV_KEY_PATTERN,
      "密码环境变量名只能包含字母、数字、下划线且不能以数字开头；请填写环境变量名，而不是密码本身"
    )
    .default("LEGACY_MYSQL_PASSWORD"),
  defaultDatabase: z.string().max(64).optional(),
  isDefault: z.boolean().default(false),
  description: z.string().max(2000).optional()
});

export const environmentUpdateSchema = environmentCreateSchema
  .omit({ envCode: true })
  .partial()
  .extend({ envStatus: z.enum(["ACTIVE", "INACTIVE"]).optional() });

export const environmentSystemUpsertSchema = z.object({
  systemCode: z.string().min(1).max(32),
  schemaMap: z.record(z.string().min(1).max(32), z.string().min(1).max(64)),
  connectionLimit: z.coerce.number().int().min(1).max(50).optional()
});

export const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export const packCreateSchema = z.object({
  packCode: z.string().min(1).max(64),
  packName: z.string().min(1).max(128),
  checkStage: z.enum(CHECK_STAGES),
  pairId: z.string().length(26).optional(),
  description: z.string().max(2000).optional()
});

export const packVersionCreateSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  sourceScripts: z.array(z.string()).default([])
});

export const publishSchema = z.object({
  dryRun: z.boolean().default(false),
  confirm: z.boolean().default(false)
});

export const datasetUpsertSchema = z.object({
  datasetName: z.string().min(1).max(128),
  sourceSystem: z.string().min(1).max(32),
  systemId: z.string().length(26).optional(),
  schemaKey: z.string().min(1).max(32).optional(),
  sourceSchema: z.string().max(64).optional(),
  transport: z.enum(["FILE", "READONLY_SQL"]),
  extractProfile: z.string().max(64).optional(),
  mapping: z.record(z.string(), z.unknown())
});

export const syncSchema = periodSchema.extend({
  environmentId: z.string().length(26).optional()
});

export const importMetaSchema = z.object({
  datasetCode: z.string().min(1),
  periodStartDate: businessDateSchema,
  periodEndDate: businessDateSchema,
  environmentId: z.string().length(26).optional(),
  format: z.enum(["CSV", "JSON"]).optional()
});

export const runCreateSchema = z.object({
  packId: z.string().length(26),
  environmentId: z.string().length(26).optional(),
  periodStartDate: businessDateSchema,
  periodEndDate: businessDateSchema,
  runMode: z.enum(["FULL", "DRY_RUN"]).default("FULL"),
  toleranceOverride: z
    .object({
      abs: moneyStringSchema,
      rel: moneyStringSchema.optional()
    })
    .optional()
});

export const runListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  environmentId: z.string().length(26).optional(),
  pairId: z.string().length(26).optional(),
  packId: z.string().length(26).optional(),
  periodStartDate: businessDateSchema.optional(),
  periodEndDate: businessDateSchema.optional()
});

export const pairReadinessQuerySchema = z.object({
  pairId: z.string().length(26),
  environmentId: z.string().length(26).optional(),
  periodStartDate: businessDateSchema,
  periodEndDate: businessDateSchema
});

export const runCreateForPairSchema = z.object({
  pairId: z.string().length(26),
  environmentId: z.string().length(26).optional(),
  periodStartDate: businessDateSchema,
  periodEndDate: businessDateSchema,
  runMode: z.enum(["FULL", "DRY_RUN"]).default("FULL")
});

export const runDiffsQuerySchema = z.object({
  metricCode: z.string().max(8).optional(),
  status: z.string().max(16).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});

export const diffListQuerySchema = z.object({
  runId: z.string().length(26).optional(),
  pairId: z.string().length(26).optional(),
  environmentId: z.string().length(26).optional(),
  metricCode: z.string().max(8).optional(),
  status: z.string().max(16).optional(),
  businessKey: z.string().max(128).optional(),
  periodStartDate: businessDateSchema.optional(),
  periodEndDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

export const adjustmentListQuerySchema = z.object({
  status: z.string().max(16).optional(),
  pairId: z.string().length(26).optional(),
  environmentId: z.string().length(26).optional()
});

export const diffAssignSchema = z.object({
  assignee: z.string().min(1).max(64),
  expectedVersion: z.number().int().positive().optional()
});

export const diffInvestigateSchema = z.object({
  note: z.string().max(2000).optional(),
  expectedVersion: z.number().int().positive().optional()
});

export const diffResolveSchema = z.object({
  resolutionType: z.string().min(1).max(32),
  note: z.string().min(1).max(2000),
  expectedVersion: z.number().int().positive().optional()
});

export const diffWriteOffSchema = z.object({
  note: z.string().min(1).max(2000),
  confirm: z.boolean(),
  expectedVersion: z.number().int().positive().optional()
});

export const diffReopenSchema = z.object({
  note: z.string().min(1).max(2000),
  expectedVersion: z.number().int().positive().optional()
});

export const diffCommentSchema = z.object({
  note: z.string().min(1).max(2000)
});

export const adjustmentCreateSchema = z.object({
  adjustmentType: z.enum([
    "SUPPLEMENT_RECEIPT",
    "SUPPLEMENT_PAYMENT",
    "REVERSAL",
    "DATA_FIX",
    "CONFIRM_WRITE_OFF"
  ]),
  amount: moneyStringSchema,
  currency: z.string().length(3),
  reason: z.string().min(1).max(2000)
});

export const gateQuerySchema = periodSchema.merge(scopeQuerySchema);

export const gateSignOffSchema = z.object({
  dryRun: z.boolean().default(false),
  confirm: z.boolean().default(false)
});

export const metricQuerySchema = z.object({
  packId: z.string().length(26).optional(),
  environmentId: z.string().length(26).optional(),
  pairId: z.string().length(26).optional(),
  periodStartDate: businessDateSchema.optional(),
  periodEndDate: businessDateSchema.optional()
});

export const financeScopeQuerySchema = periodSchema.merge(scopeQuerySchema);

export const adjustmentExportQuerySchema = z.object({
  ids: z.string().min(1)
});

export const stageSchema = z.enum(CHECK_STAGES);

export const metricTypeSchema = z.enum(METRIC_TYPES);

const envKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "环境变量名只能包含字母、数字和下划线");

export const automationConfigUpdateSchema = z
  .object({
    enabled: z.boolean().default(false),
    runTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "执行时间格式必须为 HH:mm"),
    channel: z.enum(["WEBHOOK", "APP", "BOTH", "ROBOT"]).default("WEBHOOK"),
    environmentId: z.string().length(26),
    webhookUrlEnvKey: envKeySchema.default("WECOM_WEBHOOK_URL"),
    appCorpId: z.string().max(128).optional(),
    appAgentId: z.string().regex(/^\d{1,10}$/, "AgentID 必须为数字").optional(),
    appSecretEnvKey: envKeySchema.default("WECOM_APP_SECRET"),
    toUser: z.string().max(1024).optional()
  })
  .superRefine((value, ctx) => {
    const usesWebhook = value.channel !== "APP";
    if (usesWebhook && value.webhookUrlEnvKey.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["webhookUrlEnvKey"],
        message: "群机器人渠道必须填写 Webhook 环境变量名"
      });
    }
    if (value.channel === "ROBOT") {
      if (value.toUser === undefined || value.toUser.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["toUser"],
          message: "飞书/钉钉机器人渠道必须填写 @ 接收人"
        });
      }
      return;
    }
    if (value.channel !== "WEBHOOK") {
      if (value.appCorpId === undefined || value.appCorpId.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["appCorpId"],
          message: "企业应用渠道必须填写 CorpID"
        });
      }
      if (value.appAgentId === undefined || value.appAgentId.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["appAgentId"],
          message: "企业应用渠道必须填写 AgentID"
        });
      }
      if (value.toUser === undefined || value.toUser.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["toUser"],
          message: "企业应用渠道必须填写接收人"
        });
      }
    }
  });

export const automationRunNowSchema = z.object({
  periodStartDate: businessDateSchema.optional(),
  periodEndDate: businessDateSchema.optional(),
  notify: z.boolean().default(true)
});

export const automationRunListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
