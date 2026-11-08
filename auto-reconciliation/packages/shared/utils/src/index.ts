import { createHash } from "node:crypto";

/** 计算 sha256，用于导入/执行幂等键 */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 稳定 JSON：对象键排序后序列化，保证 hash 可复现 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

/** 业务键拼接：空值统一为空串，字段间用不可见分隔符，避免歧义 */
export function joinKey(values: readonly (string | null | undefined)[]): string {
  return values.map((value) => (value == null ? "" : value)).join("");
}

/** 键值归一化：去空白、按需大写 */
export function normalizeKey(value: string | null | undefined, upper = true): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return upper ? trimmed.toUpperCase() : trimmed;
}

/**
 * 简易 CSV 解析：支持双引号、转义双引号、字段内逗号与换行。
 * 源系统导出以 CSV 为主，不引入第三方解析库。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;
  const input = text.replace(/^﻿/, "");

  while (index < input.length) {
    const char = input[index];
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      if (char === "\r" && input[index + 1] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    field += char;
    index += 1;
  }

  row.push(field);
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }
  return rows;
}

/** CSV 转对象数组；首行作为表头 */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return [];
  }
  const header = rows[0] ?? [];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((column, columnIndex) => {
      record[column.trim()] = row[columnIndex] ?? "";
    });
    return record;
  });
}

/** 限制字符串长度，避免超长键/错误信息落库失败 */
export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
