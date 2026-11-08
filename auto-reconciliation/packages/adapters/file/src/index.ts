import {
  datasetMappingSchema,
  mapSourceRecord,
  type DatasetMapping,
  type MappedRecordInput
} from "@infra/biz-reconciliation-engine";
import { csvToRecords } from "@shared/utils";

export type FileFormat = "CSV" | "JSON";

export interface RowError {
  rowNo: number;
  message: string;
}

export interface FileImportResult {
  rows: MappedRecordInput[];
  errors: RowError[];
}

export interface FileImportOptions {
  zone: string;
  defaultPeriodCode?: string;
}

export function detectFormat(fileName: string): FileFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) {
    return "JSON";
  }
  if (lower.endsWith(".csv")) {
    return "CSV";
  }
  throw new Error("仅支持 CSV / JSON 文件");
}

function toStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON 行必须是对象");
  }
  const record: Record<string, string> = {};
  for (const [key, cell] of Object.entries(value as Record<string, unknown>)) {
    record[key] = cell === null || cell === undefined ? "" : String(cell);
  }
  return record;
}

/** 解析文件内容并按数据集映射归一化；逐行收集错误，不因单行失败中断整批 */
export function importFile(
  content: string,
  format: FileFormat,
  mappingInput: unknown,
  options: FileImportOptions
): FileImportResult {
  const mapping: DatasetMapping = datasetMappingSchema.parse(mappingInput);
  let sourceRows: Record<string, string>[];
  if (format === "CSV") {
    sourceRows = csvToRecords(content);
  } else {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON 文件顶层必须是数组");
    }
    sourceRows = parsed.map(toStringRecord);
  }

  const rows: MappedRecordInput[] = [];
  const errors: RowError[] = [];
  sourceRows.forEach((source, index) => {
    try {
      rows.push(mapSourceRecord(source, mapping, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ rowNo: index + 1, message });
    }
  });
  return { rows, errors };
}
