import { z } from "zod";
import { normalizeMoney } from "./money.js";
import { parseBusinessDate } from "./time.js";
import type { AmountMap, KeyMap } from "@shared/types";

/**
 * 数据集映射：源列名 -> 归一化字段。
 * 只允许字段名引用，不解析任意表达式，避免注入与不可静态分析。
 */
export const datasetMappingSchema = z.object({
  externalIdFields: z.array(z.string().min(1)).min(1),
  businessKey: z.record(z.string(), z.string()),
  amounts: z.record(z.string(), z.string()),
  attributes: z.record(z.string(), z.string()).optional(),
  currency: z.string().optional(),
  businessDate: z.string().optional(),
  recordStatus: z.string().optional(),
  periodCode: z.string().optional(),
  defaultValues: z.record(z.string(), z.string()).optional()
});

export type DatasetMapping = z.infer<typeof datasetMappingSchema>;

export interface MappedRecordInput {
  externalId: string;
  periodCode: string | null;
  businessKey: KeyMap;
  amounts: AmountMap;
  currency: string | null;
  businessDate: string | null;
  recordStatus: string | null;
  attributes: Record<string, string | null>;
  raw: Record<string, string>;
}

export interface MapOptions {
  zone: string;
  defaultPeriodCode?: string;
}

function readValue(
  source: Record<string, string>,
  column: string,
  defaults: Record<string, string> | undefined
): string | null {
  const value = source[column];
  if (value !== undefined && value.trim() !== "") {
    return value.trim();
  }
  const fallback = defaults?.[column];
  return fallback !== undefined && fallback !== "" ? fallback : null;
}

function derivePeriodCode(
  source: Record<string, string>,
  mapping: DatasetMapping,
  businessDate: string | null,
  options: MapOptions
): string | null {
  if (mapping.periodCode !== undefined) {
    const value = readValue(source, mapping.periodCode, mapping.defaultValues);
    if (value !== null) {
      return value;
    }
  }
  if (businessDate !== null) {
    return businessDate.slice(0, 7).replace("-", "");
  }
  return options.defaultPeriodCode ?? null;
}

/** 将源行映射为暂存记录；金额/日期解析失败抛出带字段名的错误 */
export function mapSourceRecord(
  source: Record<string, string>,
  mapping: DatasetMapping,
  options: MapOptions
): MappedRecordInput {
  const defaults = mapping.defaultValues;
  const externalParts = mapping.externalIdFields.map((field) =>
    readValue(source, field, defaults)
  );
  if (externalParts.every((part) => part === null)) {
    throw new Error("外部主键为空");
  }
  const externalId = externalParts.map((part) => part ?? "").join("|");

  const businessKey: KeyMap = {};
  for (const [canonical, column] of Object.entries(mapping.businessKey)) {
    businessKey[canonical] = readValue(source, column, defaults);
  }

  const amounts: AmountMap = {};
  for (const [canonical, column] of Object.entries(mapping.amounts)) {
    const raw = readValue(source, column, defaults);
    if (raw === null) {
      amounts[canonical] = "0.0000";
      continue;
    }
    try {
      amounts[canonical] = normalizeMoney(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`金额字段 ${canonical} 非法: ${reason}`);
    }
  }

  const attributes: Record<string, string | null> = {};
  for (const [canonical, column] of Object.entries(mapping.attributes ?? {})) {
    attributes[canonical] = readValue(source, column, defaults);
  }

  const rawBusinessDate =
    mapping.businessDate === undefined
      ? null
      : readValue(source, mapping.businessDate, defaults);
  let businessDate: string | null = null;
  if (rawBusinessDate !== null) {
    try {
      businessDate = parseBusinessDate(rawBusinessDate, options.zone);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`业务日期非法: ${reason}`);
    }
  }

  return {
    externalId,
    periodCode: derivePeriodCode(source, mapping, businessDate, options),
    businessKey,
    amounts,
    currency:
      mapping.currency === undefined ? null : readValue(source, mapping.currency, defaults),
    businessDate,
    recordStatus:
      mapping.recordStatus === undefined
        ? null
        : readValue(source, mapping.recordStatus, defaults),
    attributes,
    raw: source
  };
}

/** 业务键文本：用于检索与差异展示，字段值以 | 连接 */
export function businessKeyText(keyFields: readonly string[], businessKey: KeyMap): string {
  return keyFields.map((field) => businessKey[field] ?? "").join("|");
}
