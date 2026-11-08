/**
 * 指标包配置（config_json）的前端结构读取与纯函数编辑。
 * 服务端以 Zod 校验配置，这里只做展示/增量编辑所需的宽松解析。
 */

export type DatasetRef = string | string[];

export interface PackMetricConfig {
  code: string;
  name: string;
  type: string;
  fields?: string[];
  tolerance?: { abs: string; rel?: string };
  side?: "LEFT" | "RIGHT";
  sourceAnomaly?: {
    mode: "NOT_IN" | "DISTINCT_GT";
    field: string;
    allowed?: string[];
    maxDistinct?: number;
  };
  rateField?: string;
  /** 指标 SQL 口径说明：仅作文档/审计记录，不参与执行 */
  sql?: string;
  [key: string]: unknown;
}

export interface PackComparisonConfig {
  code: string;
  name?: string;
  leftDataset: DatasetRef;
  rightDataset: DatasetRef;
  keyFields: string[];
  metrics: PackMetricConfig[];
  [key: string]: unknown;
}

export interface PackConfig {
  comparisons: PackComparisonConfig[];
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readDatasetRef(value: unknown): DatasetRef {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return "";
}

function readMetric(value: Record<string, unknown>): PackMetricConfig {
  return {
    ...value,
    code: typeof value.code === "string" ? value.code : "",
    name: typeof value.name === "string" ? value.name : "",
    type: typeof value.type === "string" ? value.type : "",
    sql: typeof value.sql === "string" ? value.sql : undefined
  } as PackMetricConfig;
}

/** 宽松读取配置；结构不可用时返回 null。 */
export function readPackConfig(value: unknown): PackConfig | null {
  if (!isRecord(value) || !Array.isArray(value.comparisons)) {
    return null;
  }
  const comparisons: PackComparisonConfig[] = [];
  for (const item of value.comparisons) {
    if (!isRecord(item)) {
      continue;
    }
    const metrics = Array.isArray(item.metrics)
      ? item.metrics.filter(isRecord).map(readMetric)
      : [];
    comparisons.push({
      ...item,
      code: typeof item.code === "string" ? item.code : "",
      name: typeof item.name === "string" ? item.name : undefined,
      leftDataset: readDatasetRef(item.leftDataset),
      rightDataset: readDatasetRef(item.rightDataset),
      keyFields: readStringArray(item.keyFields),
      metrics
    } as PackComparisonConfig);
  }
  if (comparisons.length === 0) {
    return null;
  }
  return { ...value, comparisons };
}

export function clonePackConfig(config: PackConfig): PackConfig {
  return JSON.parse(JSON.stringify(config)) as PackConfig;
}

export function datasetRefLabel(ref: DatasetRef): string {
  if (typeof ref === "string") {
    return ref === "" ? "-" : ref;
  }
  return ref.length === 0 ? "-" : ref.join("、");
}

export function countMetrics(config: PackConfig): number {
  return config.comparisons.reduce(
    (sum, comparison) => sum + comparison.metrics.length,
    0
  );
}

export function allMetricCodes(config: PackConfig): string[] {
  const codes: string[] = [];
  for (const comparison of config.comparisons) {
    for (const metric of comparison.metrics) {
      codes.push(metric.code);
    }
  }
  return codes;
}

/** 下一个可用指标代码（M001 起）；超过 999 时返回 null。 */
export function nextMetricCode(config: PackConfig): string | null {
  let max = 0;
  for (const code of allMetricCodes(config)) {
    const match = /^M(\d{3})$/.exec(code);
    if (match === null) {
      continue;
    }
    max = Math.max(max, Number(match[1]));
  }
  if (max >= 999) {
    return null;
  }
  return `M${String(max + 1).padStart(3, "0")}`;
}

export function addMetricToComparison(
  config: PackConfig,
  comparisonIndex: number,
  metric: PackMetricConfig
): PackConfig {
  const next = clonePackConfig(config);
  const comparison = next.comparisons[comparisonIndex];
  if (comparison === undefined) {
    return next;
  }
  comparison.metrics.push(metric);
  return next;
}

export function removeMetricFromComparison(
  config: PackConfig,
  comparisonIndex: number,
  metricIndex: number
): PackConfig {
  const next = clonePackConfig(config);
  const comparison = next.comparisons[comparisonIndex];
  if (comparison === undefined) {
    return next;
  }
  comparison.metrics = comparison.metrics.filter((_metric, index) => index !== metricIndex);
  return next;
}

/** 设置或清除指标的 SQL 口径说明（空/纯空白表示移除）。 */
export function updateMetricSql(
  config: PackConfig,
  comparisonIndex: number,
  metricIndex: number,
  sql: string
): PackConfig {
  const next = clonePackConfig(config);
  const comparison = next.comparisons[comparisonIndex];
  if (comparison === undefined) {
    return next;
  }
  const metric = comparison.metrics[metricIndex];
  if (metric === undefined) {
    return next;
  }
  if (sql.trim() === "") {
    delete metric.sql;
  } else {
    metric.sql = sql;
  }
  return next;
}

export interface MetricChanges {
  added: number;
  removed: number;
  modified: number;
  addedCodes: string[];
  removedCodes: string[];
  modifiedCodes: string[];
}

function metricIndexByKey(config: PackConfig): Map<string, PackMetricConfig> {
  const byKey = new Map<string, PackMetricConfig>();
  for (const comparison of config.comparisons) {
    for (const metric of comparison.metrics) {
      byKey.set(`${comparison.code}::${metric.code}`, metric);
    }
  }
  return byKey;
}

function metricSql(metric: PackMetricConfig): string {
  return typeof metric.sql === "string" ? metric.sql : "";
}

/** 比较两份配置的指标差异（按 比对代码 + 指标代码）；SQL 口径变化计入 modified。 */
export function diffMetricChanges(base: PackConfig, next: PackConfig): MetricChanges {
  const baseByKey = metricIndexByKey(base);
  const nextByKey = metricIndexByKey(next);
  const addedCodes: string[] = [];
  const removedCodes: string[] = [];
  const modifiedCodes: string[] = [];

  for (const [key, metric] of nextByKey) {
    const baseMetric = baseByKey.get(key);
    if (baseMetric === undefined) {
      addedCodes.push(key);
    } else if (metricSql(baseMetric) !== metricSql(metric)) {
      modifiedCodes.push(key);
    }
  }
  for (const key of baseByKey.keys()) {
    if (!nextByKey.has(key)) {
      removedCodes.push(key);
    }
  }
  return {
    added: addedCodes.length,
    removed: removedCodes.length,
    modified: modifiedCodes.length,
    addedCodes,
    removedCodes,
    modifiedCodes
  };
}
