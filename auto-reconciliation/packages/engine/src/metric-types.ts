import { z } from "zod";
import { businessDateSchema, moneyStringSchema } from "@shared/schemas";

/** 指标类型受限枚举；不支持用户自定义 SQL */
export const METRIC_TYPES = [
  "ROW_COUNT",
  "KEY_COUNT",
  "MISSING_LEFT",
  "MISSING_RIGHT",
  "MISSING_BOTH",
  "RECORD_COUNT_PER_KEY",
  "DUPLICATE_LEFT",
  "DUPLICATE_RIGHT",
  "SOURCE_ANOMALY",
  "AMOUNT_FIELDS",
  "RATE_FIELD"
] as const;

export type MetricType = (typeof METRIC_TYPES)[number];

export const SIDES = ["LEFT", "RIGHT"] as const;
export type Side = (typeof SIDES)[number];

export const CHECK_STAGES = ["INTERFACE", "PRE_BOOKING", "POST_BOOKING"] as const;
export type CheckStage = (typeof CHECK_STAGES)[number];

export const toleranceSchema = z.object({
  abs: moneyStringSchema,
  rel: moneyStringSchema.optional()
});

export type ToleranceConfig = z.infer<typeof toleranceSchema>;

/** 金额方向/互换规则：按月账/理赔的 SQL 口径配置，不在代码里写死 */
export const amountRuleSchema = z.object({
  when: z
    .record(
      z.string(),
      z.object({
        in: z.array(z.string()).optional(),
        equals: z.string().optional()
      })
    )
    .optional(),
  negate: z.array(z.string()).optional(),
  swapNegate: z.array(z.tuple([z.string(), z.string()])).optional(),
  setZero: z.array(z.string()).optional()
});

export type AmountRule = z.infer<typeof amountRuleSchema>;

export const zeroSkipSchema = z.object({
  fields: z.array(z.string()).min(1),
  exceptions: z
    .array(
      z.object({
        side: z.enum(SIDES),
        field: z.string(),
        in: z.array(z.string())
      })
    )
    .optional()
});

export type ZeroSkipConfig = z.infer<typeof zeroSkipSchema>;

/** 行级过滤：对应 SQL 中的费用代码/业务来源/迁移标识/核赔类型等条件 */
export const filterConfigSchema = z.object({
  side: z.enum(SIDES),
  field: z.string().min(1),
  equals: z.string().optional(),
  in: z.array(z.string()).optional(),
  notIn: z.array(z.string()).optional(),
  notStartsWith: z.array(z.string()).optional()
});

export type FilterConfig = z.infer<typeof filterConfigSchema>;

/** 指标 SQL 口径说明的最大长度（仅文档/审计用途，不参与执行）。 */
export const METRIC_SQL_MAX_LENGTH = 20_000;

export const metricConfigSchema = z
  .object({
    code: z.string().regex(/^M\d{3}$/, "指标代码必须为 M + 三位数字"),
    name: z.string().min(1),
    type: z.enum(METRIC_TYPES),
    fields: z.array(z.string()).optional(),
    tolerance: toleranceSchema.optional(),
    /** SOURCE_ANOMALY 检查哪一侧，默认 RIGHT */
    side: z.enum(SIDES).optional(),
    sourceAnomaly: z
      .object({
        mode: z.enum(["NOT_IN", "DISTINCT_GT"]),
        field: z.string(),
        allowed: z.array(z.string()).optional(),
        maxDistinct: z.number().int().min(1).optional()
      })
      .optional(),
    rateField: z.string().optional(),
    /** 指标 SQL 口径说明：仅作文档/审计记录，引擎不会执行 */
    sql: z.string().max(METRIC_SQL_MAX_LENGTH).optional()
  })
  .superRefine((metric, ctx) => {
    if (metric.type === "AMOUNT_FIELDS" && (metric.fields?.length ?? 0) === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AMOUNT_FIELDS 必须配置 fields" });
    }
    if (metric.type === "RATE_FIELD" && metric.rateField === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "RATE_FIELD 必须配置 rateField" });
    }
    if (metric.type === "SOURCE_ANOMALY" && metric.sourceAnomaly === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SOURCE_ANOMALY 必须配置 sourceAnomaly" });
    }
    if (
      metric.type === "SOURCE_ANOMALY" &&
      metric.sourceAnomaly?.mode === "NOT_IN" &&
      (metric.sourceAnomaly.allowed?.length ?? 0) === 0
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "NOT_IN 模式必须配置 allowed" });
    }
  });

export type MetricConfig = z.infer<typeof metricConfigSchema>;

const datasetRefSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const comparisonConfigSchema = z.object({
  code: z.string().min(1),
  name: z.string().optional(),
  leftDataset: datasetRefSchema,
  rightDataset: datasetRefSchema,
  keyFields: z.array(z.string().min(1)).min(1),
  normalize: z
    .object({
      trim: z.array(z.string()).optional(),
      upper: z.array(z.string()).optional()
    })
    .optional(),
  leftRules: z.array(amountRuleSchema).optional(),
  rightRules: z.array(amountRuleSchema).optional(),
  filters: z.array(filterConfigSchema).optional(),
  zeroSkip: zeroSkipSchema.optional(),
  currency: z
    .object({
      field: z.string().default("currency"),
      leftEquals: z.string().optional(),
      rightEquals: z.string().optional()
    })
    .optional(),
  metrics: z.array(metricConfigSchema).min(1)
});

export type ComparisonConfig = z.infer<typeof comparisonConfigSchema>;

export const packConfigSchema = z.object({
  comparisons: z.array(comparisonConfigSchema).min(1),
  defaults: z
    .object({
      tolerance: toleranceSchema.optional()
    })
    .optional()
});

export type PackConfig = z.infer<typeof packConfigSchema>;

export const DEFAULT_TOLERANCE: ToleranceConfig = { abs: "0.00" };

/** 引擎版本：纳入执行指纹，引擎口径变化后自动生成新执行批次 */
export const ENGINE_VERSION = "1.0.0";

export function toleranceFor(config: PackConfig, metric: MetricConfig): ToleranceConfig {
  return metric.tolerance ?? config.defaults?.tolerance ?? DEFAULT_TOLERANCE;
}

/** 指标包版本配置校验入口 */
export function parsePackConfig(value: unknown): PackConfig {
  return packConfigSchema.parse(value);
}

export const periodSchema = z.object({
  periodStartDate: businessDateSchema,
  periodEndDate: businessDateSchema
});
