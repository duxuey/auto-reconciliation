import {
  addDaysToBusinessDate,
  type MappedRecordInput
} from "@infra/biz-reconciliation-engine";
import { sha256, stableJson } from "@shared/utils";

/** 抽取键/内容哈希版本；SQL 或映射口径变化时提升，避免复用旧批次 */
export const EXTRACTION_HASH_VERSION = "v1";

export interface ExtractionRowError {
  rowNo: number;
  message: string;
}

export interface ExtractionHashInput {
  datasetCode: string;
  mappingHash: string;
  datasourceKey: string;
  extractProfile: string;
  periodStartDate: string;
  periodEndDate: string;
  rows: MappedRecordInput[];
  errors: ExtractionRowError[];
}

/** 抽取 SQL 使用半开区间 `>= start AND < end`，调用方传入的止日为闭区间 */
export function toExclusivePeriodEnd(periodEndDate: string): string {
  return addDaysToBusinessDate(periodEndDate, 1);
}

/** 去掉 raw（可能含 PII 且体积大），保留参与对账的规范化字段 */
function canonicalRow(row: MappedRecordInput): Record<string, unknown> {
  return {
    externalId: row.externalId,
    periodCode: row.periodCode,
    businessKey: row.businessKey,
    amounts: row.amounts,
    currency: row.currency,
    businessDate: row.businessDate,
    recordStatus: row.recordStatus,
    attributes: row.attributes
  };
}

/**
 * 源数据内容指纹：按行/错误排序后再哈希，避免 SQL 无 ORDER BY 导致批次抖动。
 * 相同内容复用批次，内容变化生成新批次。
 */
export function extractionContentHash(input: ExtractionHashInput): string {
  const rows = input.rows.map((row) => stableJson(canonicalRow(row))).sort();
  const errors = input.errors
    .map((error) => `${error.rowNo}:${error.message}`)
    .sort();
  return sha256(
    stableJson({
      version: EXTRACTION_HASH_VERSION,
      datasetCode: input.datasetCode,
      mappingHash: input.mappingHash,
      datasourceKey: input.datasourceKey,
      extractProfile: input.extractProfile,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      rows,
      errors
    })
  );
}

/** 直连批次幂等键：环境/数据集/期间/映射/数据源/内容 */
export function extractionSyncKey(input: ExtractionHashInput): string {
  return sha256(
    [
      EXTRACTION_HASH_VERSION,
      "DIRECT",
      input.datasetCode,
      input.extractProfile,
      input.mappingHash,
      input.datasourceKey,
      input.periodStartDate,
      input.periodEndDate,
      extractionContentHash(input)
    ].join("|")
  );
}

/** 返回重复的外部主键（仅用于报错与日志，不把具体键写入用户可见消息） */
export function findDuplicateExternalIds(rows: MappedRecordInput[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.externalId, (counts.get(row.externalId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([externalId]) => externalId)
    .sort();
}

export interface PackDatasetOutcome {
  datasetCode: string;
  transport: "READONLY_SQL" | "FILE";
  batchIds: string[];
  loaded: number;
  rejected: number;
  errorMessage?: string;
}

export type PackExecutionDecision =
  | { action: "RUN"; batchIds: string[]; rejectedRows: number }
  | { action: "SKIP"; reason: "NO_SOURCE_DATA" }
  | { action: "FAIL"; message: string };

/** 根据本次抽取结果决定指标包是否执行、无数据或失败 */
export function decidePackExecution(
  outcomes: PackDatasetOutcome[]
): PackExecutionDecision {
  const failed = outcomes.find((outcome) => outcome.errorMessage !== undefined);
  if (failed !== undefined) {
    return {
      action: "FAIL",
      message: failed.errorMessage ?? `数据集 ${failed.datasetCode} 读取失败`
    };
  }

  const allRowsFailed = outcomes.find(
    (outcome) => outcome.loaded === 0 && outcome.rejected > 0
  );
  if (allRowsFailed !== undefined) {
    return {
      action: "FAIL",
      message: `数据集 ${allRowsFailed.datasetCode} 的全部行映射失败，请检查抽取字段与数据`
    };
  }

  const loaded = outcomes.reduce((sum, outcome) => sum + outcome.loaded, 0);
  if (loaded === 0) {
    return { action: "SKIP", reason: "NO_SOURCE_DATA" };
  }

  const batchIds = [...new Set(outcomes.flatMap((outcome) => outcome.batchIds))].sort();
  if (batchIds.length === 0) {
    return { action: "FAIL", message: "抽取完成但没有可用的数据批次" };
  }

  return {
    action: "RUN",
    batchIds,
    rejectedRows: outcomes.reduce((sum, outcome) => sum + outcome.rejected, 0)
  };
}

/**
 * 直连失败对用户只给稳定、脱敏的提示；
 * 原始驱动错误（可能含 host/user）只允许写服务端日志。
 */
export function sanitizeExtractionFailure(
  _error: unknown,
  datasetCode: string
): string {
  return `数据集 ${datasetCode} 读取源库失败，请检查环境连接、网络与只读账号权限`;
}
