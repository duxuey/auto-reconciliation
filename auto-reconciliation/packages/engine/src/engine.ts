import type { KeyMap, NormalizedRecord, Side } from "@shared/types";
import {
  addMoney,
  countToMoneyString,
  diffMoney,
  exceedsTolerance,
  isZeroMoney,
  maxNumericString,
  negateMoney,
  normalizeAmounts,
  zeroMoney
} from "./money.js";
import {
  toleranceFor,
  type AmountRule,
  type ComparisonConfig,
  type FilterConfig,
  type MetricConfig,
  type PackConfig,
  type ToleranceConfig,
  type ZeroSkipConfig
} from "./metric-types.js";

export interface MetricResult {
  comparisonCode: string;
  metricCode: string;
  metricName: string;
  metricType: MetricConfig["type"];
  checkResult: "PASS" | "FAIL";
  totalCount: number;
  failCount: number;
}

export interface DiffRow {
  comparisonCode: string;
  metricCode: string;
  diffType: string;
  businessKeyText: string;
  businessKey: KeyMap;
  fieldCode: string | null;
  leftValue: string | null;
  rightValue: string | null;
  diffValue: string | null;
  leftText: string | null;
  rightText: string | null;
  currency: string | null;
}

export interface ComparisonResult {
  comparisonCode: string;
  metrics: MetricResult[];
  diffs: DiffRow[];
}

export interface EngineResult {
  metrics: MetricResult[];
  diffs: DiffRow[];
  comparisons: ComparisonResult[];
  totalRows: { left: number; right: number };
}

interface Group {
  keyInternal: string;
  keyText: string;
  key: KeyMap;
  rows: NormalizedRecord[];
  recordCount: number;
  amountSums: Record<string, string>;
  amountMax: Record<string, string>;
  currency: string | null;
}

interface PreparedSide {
  rowCount: number;
  groups: Group[];
}

interface RunContext {
  comparison: ComparisonConfig;
  diffs: DiffRow[];
  leftByKey: Map<string, Group>;
  rightByKey: Map<string, Group>;
  leftGroups: Group[];
  rightGroups: Group[];
  leftRowCount: number;
  rightRowCount: number;
  primaryField: string | null;
}

function datasetSet(value: ComparisonConfig["leftDataset"]): Set<string> {
  return new Set(Array.isArray(value) ? value : [value]);
}

function matchesWhen(
  condition: AmountRule["when"],
  attributes: Record<string, string | null>
): boolean {
  if (condition === undefined) {
    return true;
  }
  for (const [field, expected] of Object.entries(condition)) {
    const actual = attributes[field] ?? null;
    if (expected.equals !== undefined && actual !== expected.equals) {
      return false;
    }
    if (expected.in !== undefined && (actual === null || !expected.in.includes(actual))) {
      return false;
    }
  }
  return true;
}

function applyAmountRules(
  amounts: Record<string, string>,
  rules: readonly AmountRule[],
  attributes: Record<string, string | null>
): Record<string, string> {
  const result: Record<string, string> = { ...amounts };
  for (const rule of rules) {
    if (!matchesWhen(rule.when, attributes)) {
      continue;
    }
    for (const field of rule.negate ?? []) {
      result[field] = negateMoney(result[field] ?? zeroMoney());
    }
    for (const [leftField, rightField] of rule.swapNegate ?? []) {
      const leftValue = result[leftField] ?? zeroMoney();
      const rightValue = result[rightField] ?? zeroMoney();
      result[leftField] = negateMoney(rightValue);
      result[rightField] = negateMoney(leftValue);
    }
    for (const field of rule.setZero ?? []) {
      result[field] = zeroMoney();
    }
  }
  return result;
}

function normalizeKeyPart(
  value: string | null,
  upper: boolean
): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return upper ? trimmed.toUpperCase() : trimmed;
}

function buildKey(
  businessKey: KeyMap,
  comparison: ComparisonConfig
): { internal: string; text: string; key: KeyMap } {
  const normalized: KeyMap = {};
  // 键名排序后拼接：与暂存层的 business_key_text 口径一致，保证差异可钻取
  const sortedFields = [...comparison.keyFields].sort();
  const values: string[] = [];
  for (const field of sortedFields) {
    const upper = comparison.normalize?.upper?.includes(field) ?? false;
    const value = normalizeKeyPart(businessKey[field] ?? null, upper);
    normalized[field] = value;
    values.push(value ?? "");
  }
  return { internal: JSON.stringify(values), text: values.join("|"), key: normalized };
}

function currencyMatches(
  record: NormalizedRecord,
  comparison: ComparisonConfig,
  side: Side
): boolean {
  const rule = comparison.currency;
  if (rule === undefined) {
    return true;
  }
  const expected = side === "LEFT" ? rule.leftEquals : rule.rightEquals;
  if (expected === undefined) {
    return true;
  }
  return (record.currency ?? "").trim().toUpperCase() === expected.trim().toUpperCase();
}

function matchesFilters(
  record: NormalizedRecord,
  filters: readonly FilterConfig[] | undefined,
  side: Side
): boolean {
  for (const filter of filters ?? []) {
    if (filter.side !== side) {
      continue;
    }
    const value =
      filter.field === "currency"
        ? record.currency
        : record.attributes[filter.field] ?? null;
    if (filter.equals !== undefined && value !== filter.equals) {
      return false;
    }
    if (filter.in !== undefined && (value === null || !filter.in.includes(value))) {
      return false;
    }
    if (filter.notIn !== undefined && value !== null && filter.notIn.includes(value)) {
      return false;
    }
    if (
      filter.notStartsWith !== undefined &&
      value !== null &&
      filter.notStartsWith.some((prefix) => value.startsWith(prefix))
    ) {
      return false;
    }
  }
  return true;
}

function shouldSkipGroup(
  group: Group,
  zeroSkip: ZeroSkipConfig,
  side: Side
): boolean {
  const allZero = zeroSkip.fields.every((field) =>
    isZeroMoney(group.amountSums[field] ?? zeroMoney())
  );
  if (!allZero) {
    return false;
  }
  for (const exception of zeroSkip.exceptions ?? []) {
    if (exception.side !== side) {
      continue;
    }
    for (const row of group.rows) {
      const value = row.attributes[exception.field] ?? null;
      if (value !== null && exception.in.includes(value)) {
        return false;
      }
    }
  }
  return true;
}

function prepareSide(
  records: readonly NormalizedRecord[],
  datasets: Set<string>,
  comparison: ComparisonConfig,
  side: Side,
  rules: readonly AmountRule[],
  zeroSkip: ZeroSkipConfig | undefined
): PreparedSide {
  const groups = new Map<string, Group>();
  let rowCount = 0;

  for (const record of records) {
    if (record.side !== side || !datasets.has(record.datasetCode)) {
      continue;
    }
    if (!currencyMatches(record, comparison, side)) {
      continue;
    }
    if (!matchesFilters(record, comparison.filters, side)) {
      continue;
    }
    rowCount += 1;
    const amounts = normalizeAmounts(
      applyAmountRules(record.amounts, rules, record.attributes)
    );
    const built = buildKey(record.businessKey, comparison);
    const existing = groups.get(built.internal);
    if (existing === undefined) {
      const sums: Record<string, string> = {};
      const maximums: Record<string, string> = {};
      for (const [field, value] of Object.entries(amounts)) {
        sums[field] = value;
        maximums[field] = value;
      }
      groups.set(built.internal, {
        keyInternal: built.internal,
        keyText: built.text,
        key: built.key,
        rows: [record],
        recordCount: 1,
        amountSums: sums,
        amountMax: maximums,
        currency: record.currency
      });
      continue;
    }

    existing.rows.push(record);
    existing.recordCount += 1;
    for (const [field, value] of Object.entries(amounts)) {
      existing.amountSums[field] = addMoney(existing.amountSums[field] ?? zeroMoney(), value);
      existing.amountMax[field] = maxNumericString(
        existing.amountMax[field] ?? zeroMoney(),
        value
      );
    }
    if (existing.currency === null && record.currency !== null) {
      existing.currency = record.currency;
    }
  }

  const allGroups = [...groups.values()];
  const kept =
    zeroSkip === undefined
      ? allGroups
      : allGroups.filter((group) => !shouldSkipGroup(group, zeroSkip, side));

  return { rowCount, groups: kept };
}

function groupAmount(group: Group | undefined, field: string): string {
  return group?.amountSums[field] ?? zeroMoney();
}

function groupRate(group: Group | undefined, field: string): string {
  return group?.amountMax[field] ?? zeroMoney();
}

function groupCurrency(group: Group | undefined): string | null {
  if (group === undefined) {
    return null;
  }
  if (group.currency !== null) {
    return group.currency;
  }
  return group.key.currency ?? null;
}

function primaryAmountField(comparison: ComparisonConfig): string | null {
  for (const metric of comparison.metrics) {
    if (metric.type === "AMOUNT_FIELDS") {
      const first = metric.fields?.[0];
      if (first !== undefined) {
        return first;
      }
    }
  }
  return null;
}

function pushDiff(
  ctx: RunContext,
  metric: MetricConfig,
  diffType: string,
  group: Group | undefined,
  fieldCode: string | null,
  leftValue: string | null,
  rightValue: string | null,
  diffValue: string | null,
  leftText: string | null = null,
  rightText: string | null = null
): void {
  if (group === undefined) {
    return;
  }
  ctx.diffs.push({
    comparisonCode: ctx.comparison.code,
    metricCode: metric.code,
    diffType,
    businessKeyText: group.keyText,
    businessKey: group.key,
    fieldCode,
    leftValue,
    rightValue,
    diffValue,
    leftText,
    rightText,
    currency: groupCurrency(group)
  });
}

function metricResult(
  comparisonCode: string,
  metric: MetricConfig,
  totalCount: number,
  failCount: number
): MetricResult {
  return {
    comparisonCode,
    metricCode: metric.code,
    metricName: metric.name,
    metricType: metric.type,
    checkResult: failCount === 0 ? "PASS" : "FAIL",
    totalCount,
    failCount
  };
}

function sortedGroups(groups: Map<string, Group>): Group[] {
  return [...groups.values()].sort((left, right) =>
    left.keyText.localeCompare(right.keyText)
  );
}

function evaluateMetric(
  ctx: RunContext,
  metric: MetricConfig,
  tolerance: ToleranceConfig
): MetricResult {
  const comparisonCode = ctx.comparison.code;
  const matchedKeys = [...ctx.leftByKey.keys()]
    .filter((key) => ctx.rightByKey.has(key))
    .sort((left, right) => left.localeCompare(right));

  switch (metric.type) {
    case "ROW_COUNT": {
      const failCount = Math.abs(ctx.rightRowCount - ctx.leftRowCount);
      if (failCount > 0) {
        const anchor = ctx.leftGroups[0] ?? ctx.rightGroups[0];
        pushDiff(
          ctx,
          metric,
          "ROW_COUNT_MISMATCH",
          anchor,
          null,
          countToMoneyString(ctx.leftRowCount),
          countToMoneyString(ctx.rightRowCount),
          countToMoneyString(ctx.rightRowCount - ctx.leftRowCount),
          String(ctx.leftRowCount),
          String(ctx.rightRowCount)
        );
      }
      return metricResult(
        comparisonCode,
        metric,
        Math.max(ctx.leftRowCount, ctx.rightRowCount),
        failCount
      );
    }

    case "KEY_COUNT": {
      const failCount = Math.abs(ctx.rightGroups.length - ctx.leftGroups.length);
      if (failCount > 0) {
        const anchor = ctx.leftGroups[0] ?? ctx.rightGroups[0];
        pushDiff(
          ctx,
          metric,
          "KEY_COUNT_MISMATCH",
          anchor,
          null,
          countToMoneyString(ctx.leftGroups.length),
          countToMoneyString(ctx.rightGroups.length),
          countToMoneyString(ctx.rightGroups.length - ctx.leftGroups.length),
          String(ctx.leftGroups.length),
          String(ctx.rightGroups.length)
        );
      }
      return metricResult(
        comparisonCode,
        metric,
        Math.max(ctx.leftGroups.length, ctx.rightGroups.length),
        failCount
      );
    }

    case "MISSING_LEFT": {
      const missing = ctx.leftGroups.filter((group) => !ctx.rightByKey.has(group.keyInternal));
      for (const group of missing) {
        const amount =
          ctx.primaryField === null ? null : groupAmount(group, ctx.primaryField);
        pushDiff(
          ctx,
          metric,
          "MISSING_LEFT",
          group,
          ctx.primaryField,
          amount,
          "0.0000",
          amount === null ? null : negateMoney(amount)
        );
      }
      return metricResult(comparisonCode, metric, ctx.leftGroups.length, missing.length);
    }

    case "MISSING_RIGHT": {
      const missing = ctx.rightGroups.filter((group) => !ctx.leftByKey.has(group.keyInternal));
      for (const group of missing) {
        const amount =
          ctx.primaryField === null ? null : groupAmount(group, ctx.primaryField);
        pushDiff(ctx, metric, "MISSING_RIGHT", group, ctx.primaryField, "0.0000", amount, amount);
      }
      return metricResult(comparisonCode, metric, ctx.rightGroups.length, missing.length);
    }

    case "MISSING_BOTH": {
      const leftMissing = ctx.leftGroups.filter((group) => !ctx.rightByKey.has(group.keyInternal));
      const rightMissing = ctx.rightGroups.filter((group) => !ctx.leftByKey.has(group.keyInternal));
      for (const group of leftMissing) {
        const amount =
          ctx.primaryField === null ? null : groupAmount(group, ctx.primaryField);
        pushDiff(
          ctx,
          metric,
          "MISSING_LEFT",
          group,
          ctx.primaryField,
          amount,
          "0.0000",
          amount === null ? null : negateMoney(amount)
        );
      }
      for (const group of rightMissing) {
        const amount =
          ctx.primaryField === null ? null : groupAmount(group, ctx.primaryField);
        pushDiff(ctx, metric, "MISSING_RIGHT", group, ctx.primaryField, "0.0000", amount, amount);
      }
      return metricResult(
        comparisonCode,
        metric,
        ctx.leftGroups.length + ctx.rightGroups.length,
        leftMissing.length + rightMissing.length
      );
    }

    case "RECORD_COUNT_PER_KEY": {
      let failCount = 0;
      for (const key of matchedKeys) {
        const left = ctx.leftByKey.get(key);
        const right = ctx.rightByKey.get(key);
        if (left === undefined || right === undefined || left.recordCount === right.recordCount) {
          continue;
        }
        failCount += 1;
        pushDiff(
          ctx,
          metric,
          "RECORD_COUNT_MISMATCH",
          left,
          null,
          countToMoneyString(left.recordCount),
          countToMoneyString(right.recordCount),
          countToMoneyString(right.recordCount - left.recordCount),
          String(left.recordCount),
          String(right.recordCount)
        );
      }
      return metricResult(comparisonCode, metric, matchedKeys.length, failCount);
    }

    case "DUPLICATE_LEFT":
    case "DUPLICATE_RIGHT": {
      const groups = metric.type === "DUPLICATE_LEFT" ? ctx.leftGroups : ctx.rightGroups;
      const duplicates = groups.filter((group) => group.recordCount > 1);
      for (const group of duplicates) {
        pushDiff(
          ctx,
          metric,
          "DUPLICATE",
          group,
          null,
          metric.type === "DUPLICATE_LEFT" ? countToMoneyString(group.recordCount) : "0.0000",
          metric.type === "DUPLICATE_RIGHT" ? countToMoneyString(group.recordCount) : "0.0000",
          null,
          String(group.recordCount),
          String(group.recordCount)
        );
      }
      return metricResult(comparisonCode, metric, groups.length, duplicates.length);
    }

    case "SOURCE_ANOMALY": {
      const anomaly = metric.sourceAnomaly;
      if (anomaly === undefined) {
        return metricResult(comparisonCode, metric, 0, 0);
      }
      const side: Side = metric.side ?? "RIGHT";
      const groups = side === "LEFT" ? ctx.leftGroups : ctx.rightGroups;
      const other = side === "LEFT" ? ctx.rightByKey : ctx.leftByKey;
      // NOT_IN 只看与对侧存在同键的记录；DISTINCT_GT 统计该侧全部业务键（与 SQL 口径一致）
      const scoped =
        anomaly.mode === "NOT_IN"
          ? groups.filter((group) => other.has(group.keyInternal))
          : groups;
      let failCount = 0;

      for (const group of scoped) {
        const values = new Set<string>();
        for (const row of group.rows) {
          const value = row.attributes[anomaly.field] ?? null;
          if (value !== null) {
            values.add(value);
          }
        }
        const valueList = [...values].sort();
        let failed = false;
        if (anomaly.mode === "NOT_IN") {
          const allowed = new Set(anomaly.allowed ?? []);
          failed = valueList.length === 0 || valueList.some((value) => !allowed.has(value));
        } else {
          failed = valueList.length > (anomaly.maxDistinct ?? 1);
        }
        if (failed) {
          failCount += 1;
          pushDiff(
            ctx,
            metric,
            `SOURCE_ANOMALY_${anomaly.mode}`,
            group,
            anomaly.field,
            null,
            null,
            null,
            valueList.join(","),
            null
          );
        }
      }
      return metricResult(comparisonCode, metric, scoped.length, failCount);
    }

    case "AMOUNT_FIELDS": {
      const fields = metric.fields ?? [];
      let totalCount = 0;
      let failCount = 0;
      for (const key of matchedKeys) {
        const left = ctx.leftByKey.get(key);
        const right = ctx.rightByKey.get(key);
        for (const field of fields) {
          totalCount += 1;
          const leftValue = groupAmount(left, field);
          const rightValue = groupAmount(right, field);
          if (!exceedsTolerance(leftValue, rightValue, tolerance)) {
            continue;
          }
          failCount += 1;
          pushDiff(
            ctx,
            metric,
            "AMOUNT_MISMATCH",
            left ?? right,
            field,
            leftValue,
            rightValue,
            diffMoney(leftValue, rightValue)
          );
        }
      }
      return metricResult(comparisonCode, metric, totalCount, failCount);
    }

    case "RATE_FIELD": {
      const field = metric.rateField;
      if (field === undefined) {
        return metricResult(comparisonCode, metric, 0, 0);
      }
      let failCount = 0;
      for (const key of matchedKeys) {
        const left = ctx.leftByKey.get(key);
        const right = ctx.rightByKey.get(key);
        const leftValue = groupRate(left, field);
        const rightValue = groupRate(right, field);
        if (!exceedsTolerance(leftValue, rightValue, tolerance)) {
          continue;
        }
        failCount += 1;
        pushDiff(
          ctx,
          metric,
          "RATE_MISMATCH",
          left ?? right,
          field,
          leftValue,
          rightValue,
          diffMoney(leftValue, rightValue)
        );
      }
      return metricResult(comparisonCode, metric, matchedKeys.length, failCount);
    }

    default:
      return metricResult(comparisonCode, metric, 0, 0);
  }
}

function evaluateComparison(
  config: PackConfig,
  comparison: ComparisonConfig,
  records: readonly NormalizedRecord[]
): ComparisonResult {
  const leftDatasets = datasetSet(comparison.leftDataset);
  const rightDatasets = datasetSet(comparison.rightDataset);
  const left = prepareSide(
    records,
    leftDatasets,
    comparison,
    "LEFT",
    comparison.leftRules ?? [],
    comparison.zeroSkip
  );
  const right = prepareSide(
    records,
    rightDatasets,
    comparison,
    "RIGHT",
    comparison.rightRules ?? [],
    comparison.zeroSkip
  );

  const leftByKey = new Map(left.groups.map((group) => [group.keyInternal, group]));
  const rightByKey = new Map(right.groups.map((group) => [group.keyInternal, group]));

  const ctx: RunContext = {
    comparison,
    diffs: [],
    leftByKey,
    rightByKey,
    leftGroups: sortedGroups(leftByKey),
    rightGroups: sortedGroups(rightByKey),
    leftRowCount: left.rowCount,
    rightRowCount: right.rowCount,
    primaryField: primaryAmountField(comparison)
  };

  const metrics = comparison.metrics.map((metric) =>
    evaluateMetric(ctx, metric, toleranceFor(config, metric))
  );

  const diffs = ctx.diffs.sort((leftDiff, rightDiff) => {
    const byMetric = leftDiff.metricCode.localeCompare(rightDiff.metricCode);
    if (byMetric !== 0) {
      return byMetric;
    }
    const byKey = leftDiff.businessKeyText.localeCompare(rightDiff.businessKeyText);
    if (byKey !== 0) {
      return byKey;
    }
    return (leftDiff.fieldCode ?? "").localeCompare(rightDiff.fieldCode ?? "");
  });

  return { comparisonCode: comparison.code, metrics, diffs };
}

/**
 * 执行一个指标包版本。
 * 纯函数：不读写数据库、不感知租户/期间；调用方负责筛选期间的暂存记录。
 */
export function runPack(config: PackConfig, records: readonly NormalizedRecord[]): EngineResult {
  const comparisons: ComparisonResult[] = [];
  let leftRows = 0;
  let rightRows = 0;

  for (const comparison of config.comparisons) {
    const result = evaluateComparison(config, comparison, records);
    comparisons.push(result);
    const leftDatasets = datasetSet(comparison.leftDataset);
    const rightDatasets = datasetSet(comparison.rightDataset);
    leftRows += records.filter(
      (record) => record.side === "LEFT" && leftDatasets.has(record.datasetCode)
    ).length;
    rightRows += records.filter(
      (record) => record.side === "RIGHT" && rightDatasets.has(record.datasetCode)
    ).length;
  }

  return {
    metrics: comparisons.flatMap((comparison) => comparison.metrics),
    diffs: comparisons.flatMap((comparison) => comparison.diffs),
    comparisons,
    totalRows: { left: leftRows, right: rightRows }
  };
}
