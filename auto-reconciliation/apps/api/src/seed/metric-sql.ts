import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { METRIC_SQL_MAX_LENGTH } from "@infra/biz-reconciliation-engine";

/**
 * 指标 SQL 口径来源文件。
 *
 * 这些 SQL 仅随指标配置保存为文档/审计说明，引擎不会执行。
 * 文件从外部《自动对账指标》目录中筛选后固化到仓库，便于 `pnpm seed` 复现。
 */
const SOURCE_DIR = fileURLToPath(new URL("./metric-sql/", import.meta.url));

const SOURCE_FILES = {
  claimsCombined: "claims-combined.sql",
  claimsFac: "claims-fac.sql",
  uwFac: "uw-fac.sql",
  rpRi: "rp-ri.sql"
} as const;

const CLAIMS_MAIN_CODES = [
  "M001",
  "M002",
  "M003",
  "M004",
  "M005",
  "M006",
  "M007",
  "M008",
  "M101",
  "M102",
  "M109"
] as const;

const CLAIMS_COINS_CODES = [
  "M201",
  "M202",
  "M203",
  "M204",
  "M205",
  "M206",
  "M207",
  "M208",
  "M209"
] as const;

const CLAIMS_CVRG_CODES = ["M301", "M302", "M303"] as const;
const CLAIMS_FAC_CODES = [...CLAIMS_MAIN_CODES] as const;
const UW_FAC_CODES = [
  "M001",
  "M002",
  "M003",
  "M004",
  "M005",
  "M006",
  "M007",
  "M008",
  "M101",
  "M102",
  "M103"
] as const;
const RP_RI_CODES = ["M001", "M002", "M003"] as const;

function readSource(fileName: string): string {
  return readFileSync(join(SOURCE_DIR, fileName), "utf8");
}

function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === quote) {
      if (text[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return text.length;
}

function skipLineComment(text: string, start: number): number {
  const newline = text.indexOf("\n", start + 1);
  return newline === -1 ? text.length : newline;
}

function skipBlockComment(text: string, start: number): number {
  const end = text.indexOf("*/", start + 2);
  return end === -1 ? text.length : end + 1;
}

function findMatchingParen(text: string, openIndex: number, label: string): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" || char === "`") {
      index = skipQuoted(text, index);
      continue;
    }
    if (char === "-" && text[index + 1] === "-") {
      index = skipLineComment(text, index);
      continue;
    }
    if (char === "#") {
      index = skipLineComment(text, index);
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      index = skipBlockComment(text, index);
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error(`${label} 括号不匹配`);
}

function isBalanced(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" || char === "`") {
      index = skipQuoted(text, index);
      continue;
    }
    if (char === "-" && text[index + 1] === "-") {
      index = skipLineComment(text, index);
      continue;
    }
    if (char === "#") {
      index = skipLineComment(text, index);
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      index = skipBlockComment(text, index);
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function splitTopLevelUnionAll(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "'" || char === "`") {
      index = skipQuoted(body, index);
      continue;
    }
    if (char === "-" && body[index + 1] === "-") {
      index = skipLineComment(body, index);
      continue;
    }
    if (char === "#") {
      index = skipLineComment(body, index);
      continue;
    }
    if (char === "/" && body[index + 1] === "*") {
      index = skipBlockComment(body, index);
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    const previous = body[index - 1];
    if (previous !== undefined && /[A-Za-z0-9_]/.test(previous)) {
      continue;
    }
    const token = /^UNION\s+ALL\b/i.exec(body.slice(index, index + 32));
    if (token === null) {
      continue;
    }
    parts.push(body.slice(last, index).trim());
    index += token[0].length - 1;
    last = index + 1;
  }
  parts.push(body.slice(last).trim());
  return parts.filter((part) => part.length > 0);
}

function extractPreamble(text: string): string {
  const lines = text.split(/\r?\n/);
  const collected: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^SET\s+@/i.test(trimmed)) {
      collected.push(trimmed);
      continue;
    }
    if (collected.length > 0 && trimmed.startsWith("--")) {
      collected.push(trimmed);
      continue;
    }
    if (collected.length > 0 && trimmed !== "") {
      break;
    }
  }
  return collected.join("\n");
}

function sliceStatement(block: string, label: string): string {
  const startMatch = /^\s*(WITH|SELECT)\b/im.exec(block);
  if (startMatch === null) {
    throw new Error(`${label} 未找到 SQL 起点`);
  }
  const end = block.lastIndexOf(";");
  if (end < startMatch.index) {
    throw new Error(`${label} 未找到 SQL 结束符`);
  }
  return block.slice(startMatch.index, end + 1).trim();
}

function decorate(
  sourceFile: string,
  sql: string,
  preamble: string,
  parameterNote: string
): string {
  const parameters = preamble.trim() === "" ? "" : `${preamble.trim()}\n`;
  return [
    `-- 指标 SQL 口径（来源：${sourceFile}）`,
    `-- 仅作文档/审计记录，系统不会执行；${parameterNote}`,
    parameters + sql
  ].join("\n");
}

function codeOf(branch: string): string | undefined {
  const match = /'M(\d{3})'/.exec(branch);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return `M${match[1]}`;
}

/**
 * 解析以「指标 Mxxx：」注释块分隔的脚本（综合理赔、临分分入理赔）。
 * M301 的头部缺少 `/*`，因此只依赖指标标题行定位，不依赖完整注释壳。
 */
export function parseDelimitedMetricSql(text: string, sourceFile: string): Map<string, string> {
  const lines = text.split(/\r?\n/);
  const headers: Array<{ code: string; line: number }> = [];
  for (let line = 0; line < lines.length; line += 1) {
    const match = /^\s*指标\s+(M\d{3})：/.exec(lines[line] ?? "");
    if (match?.[1] !== undefined) {
      headers.push({ code: match[1], line });
    }
  }
  if (headers.length === 0) {
    throw new Error(`${sourceFile} 未找到指标分隔头`);
  }
  const preamble = extractPreamble(text);
  const result = new Map<string, string>();
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (header === undefined) {
      continue;
    }
    if (result.has(header.code)) {
      throw new Error(`${sourceFile} 指标 ${header.code} 重复`);
    }
    const next = headers[index + 1];
    const block = lines.slice(header.line, next?.line ?? lines.length).join("\n");
    const sql = sliceStatement(block, `${sourceFile} ${header.code}`);
    result.set(
      header.code,
      decorate(sourceFile, sql, preamble, "执行前请按实际核对期间调整下方 SET 参数。")
    );
  }
  return result;
}

/** 解析收付脚本：SQL 2/3/4 分别对应 M001/M002/M003，SQL 1 为辅助查询。 */
export function parseRpMetricSql(text: string, sourceFile: string): Map<string, string> {
  const lines = text.split(/\r?\n/);
  const headers: Array<{ id: number; line: number }> = [];
  for (let line = 0; line < lines.length; line += 1) {
    const match = /^\s*\*?\s*SQL\s+(\d+)\s*：/.exec(lines[line] ?? "");
    if (match?.[1] !== undefined) {
      headers.push({ id: Number(match[1]), line });
    }
  }
  const byId = new Map<number, string>();
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (header === undefined) {
      continue;
    }
    const next = headers[index + 1];
    const block = lines.slice(header.line, next?.line ?? lines.length).join("\n");
    byId.set(header.id, sliceStatement(block, `${sourceFile} SQL ${header.id}`));
  }
  const preamble = extractPreamble(text);
  const result = new Map<string, string>();
  const mapping: ReadonlyArray<readonly [number, string]> = [
    [2, "M001"],
    [3, "M002"],
    [4, "M003"]
  ];
  for (const [id, code] of mapping) {
    const sql = byId.get(id);
    if (sql === undefined) {
      throw new Error(`${sourceFile} 缺少 SQL ${id}`);
    }
    result.set(
      code,
      decorate(sourceFile, sql, preamble, "执行前请按实际核对期间调整下方 SET 参数。")
    );
  }
  return result;
}

function findCte(
  text: string,
  name: string,
  label: string
): { start: number; bodyStart: number; bodyEnd: number; end: number } {
  const match = new RegExp(`\\b${name}\\s+AS\\s*\\(`, "i").exec(text);
  if (match === null) {
    throw new Error(`${label} 未找到 CTE ${name}`);
  }
  const open = match.index + match[0].lastIndexOf("(");
  const close = findMatchingParen(text, open, `${label} ${name}`);
  return { start: match.index, bodyStart: open + 1, bodyEnd: close, end: close + 1 };
}

/**
 * 解析单语句承保脚本：
 * - M001-M008 取 `metric_detail` 的对应分支；
 * - M101-M103 取 `amt_diff_rows` 的对应金额分支 + `metric_detail` 的金额直通分支。
 */
export function parseUwFacMetricSql(text: string, sourceFile: string): Map<string, string> {
  const amt = findCte(text, "amt_diff_rows", sourceFile);
  const detail = findCte(text, "metric_detail", sourceFile);
  // 去掉整份脚本的文件头注释，每个指标只保留查询本身，避免诊断信息干扰阅读。
  const head = text
    .slice(0, amt.start)
    .trimEnd()
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")
    .trimStart();
  if (!/^WITH\b/i.test(head)) {
    throw new Error(`${sourceFile} 公共 CTE 起点异常`);
  }
  if (!head.endsWith(",")) {
    throw new Error(`${sourceFile} 公共 CTE 结尾缺少逗号`);
  }
  const tail = text.slice(detail.end).trim();
  if (!/^SELECT\b/i.test(tail) || !tail.endsWith(";")) {
    throw new Error(`${sourceFile} 最终 SELECT 结构异常`);
  }

  const amtBranches = splitTopLevelUnionAll(text.slice(amt.bodyStart, amt.bodyEnd));
  const detailBranches = splitTopLevelUnionAll(text.slice(detail.bodyStart, detail.bodyEnd));

  const amtByCode = new Map<string, string[]>();
  for (const branch of amtBranches) {
    const code = codeOf(branch);
    if (code === undefined) {
      throw new Error(`${sourceFile} 金额分支缺少指标代码`);
    }
    const existing = amtByCode.get(code) ?? [];
    existing.push(branch);
    amtByCode.set(code, existing);
  }
  const detailByCode = new Map<string, string>();
  let passthrough: string | undefined;
  for (const branch of detailBranches) {
    const code = codeOf(branch);
    if (code === undefined) {
      if (passthrough !== undefined) {
        throw new Error(`${sourceFile} 金额直通分支重复`);
      }
      passthrough = branch;
      continue;
    }
    if (detailByCode.has(code)) {
      throw new Error(`${sourceFile} 指标 ${code} 分支重复`);
    }
    detailByCode.set(code, branch);
  }
  if (passthrough === undefined) {
    throw new Error(`${sourceFile} 未找到金额直通分支`);
  }

  const expectedDetail = ["M001", "M002", "M003", "M004", "M005", "M006", "M007", "M008"];
  const actualDetail = [...detailByCode.keys()].sort();
  if (JSON.stringify(actualDetail) !== JSON.stringify(expectedDetail)) {
    throw new Error(`${sourceFile} 指标分支代码不完整：${actualDetail.join(",")}`);
  }
  const expectedAmount = ["M101", "M102", "M103"];
  const actualAmount = [...amtByCode.keys()].sort();
  if (JSON.stringify(actualAmount) !== JSON.stringify(expectedAmount)) {
    throw new Error(`${sourceFile} 金额分支代码不完整：${actualAmount.join(",")}`);
  }

  const result = new Map<string, string>();
  for (const code of expectedDetail) {
    const branch = detailByCode.get(code);
    if (branch === undefined) {
      throw new Error(`${sourceFile} 缺少指标 ${code} 分支`);
    }
    if (/\bamt_diff_rows\b/i.test(branch)) {
      throw new Error(`${sourceFile} 指标 ${code} 分支错误引用 amt_diff_rows`);
    }
    const sql = `${head}\nmetric_detail AS (\n${branch}\n)\n${tail}`;
    result.set(
      code,
      decorate(sourceFile, sql, "", "执行前请调整 params CTE 中的核对期间。")
    );
  }
  for (const code of expectedAmount) {
    const branches = amtByCode.get(code);
    if (branches === undefined || branches.length === 0) {
      throw new Error(`${sourceFile} 缺少指标 ${code} 金额分支`);
    }
    const sql = [
      head,
      "amt_diff_rows AS (",
      branches.join("\nUNION ALL\n"),
      "),",
      "metric_detail AS (",
      passthrough,
      ")",
      tail
    ].join("\n");
    result.set(
      code,
      decorate(sourceFile, sql, "", "执行前请调整 params CTE 中的核对期间。")
    );
  }
  return result;
}

function assertGeneratedSql(
  label: string,
  code: string,
  sql: string,
  allowExtraMetricCodes = false
): void {
  if (sql.trim() === "") {
    throw new Error(`${label} 的 SQL 为空`);
  }
  if (sql.length > METRIC_SQL_MAX_LENGTH) {
    throw new Error(`${label} 的 SQL 超过 ${METRIC_SQL_MAX_LENGTH} 字符`);
  }
  if (!/\bWITH\b/i.test(sql)) {
    throw new Error(`${label} 的 SQL 缺少 WITH`);
  }
  if (!sql.trimEnd().endsWith(";")) {
    throw new Error(`${label} 的 SQL 未以分号结尾`);
  }
  if (!isBalanced(sql)) {
    throw new Error(`${label} 的 SQL 括号不平衡`);
  }
  const literalCodes = [...sql.matchAll(/'M(\d{3})'/g)].map((match) => `M${match[1]}`);
  if (allowExtraMetricCodes) {
    // 承保脚本的最终 ORDER BY 固定列出全部指标代码，分支本身已在解析时按代码校验。
    if (!literalCodes.includes(code)) {
      throw new Error(`${label} 的 SQL 缺少指标代码 ${code}`);
    }
    return;
  }
  for (const literalCode of literalCodes) {
    if (literalCode !== code) {
      throw new Error(`${label} 的 SQL 混入其他指标 '${literalCode}'`);
    }
  }
}

function pick(
  source: Map<string, string>,
  codes: readonly string[],
  label: string,
  allowExtraMetricCodes = false
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const code of codes) {
    const sql = source.get(code);
    if (sql === undefined) {
      throw new Error(`${label} 缺少指标 ${code} 的 SQL`);
    }
    assertGeneratedSql(`${label} ${code}`, code, sql, allowExtraMetricCodes);
    result[code] = sql;
  }
  return result;
}

function assertSourceSize(source: Map<string, string>, expected: number, label: string): void {
  if (source.size !== expected) {
    throw new Error(`${label} 解析出 ${source.size} 个指标，预期 ${expected} 个`);
  }
}

const claimsCombined = parseDelimitedMetricSql(
  readSource(SOURCE_FILES.claimsCombined),
  SOURCE_FILES.claimsCombined
);
const claimsFac = parseDelimitedMetricSql(readSource(SOURCE_FILES.claimsFac), SOURCE_FILES.claimsFac);
const uwFac = parseUwFacMetricSql(readSource(SOURCE_FILES.uwFac), SOURCE_FILES.uwFac);
const rpRi = parseRpMetricSql(readSource(SOURCE_FILES.rpRi), SOURCE_FILES.rpRi);

assertSourceSize(claimsCombined, 23, SOURCE_FILES.claimsCombined);
assertSourceSize(claimsFac, CLAIMS_FAC_CODES.length, SOURCE_FILES.claimsFac);
assertSourceSize(uwFac, UW_FAC_CODES.length, SOURCE_FILES.uwFac);
assertSourceSize(rpRi, RP_RI_CODES.length, SOURCE_FILES.rpRi);

const coveredClaimsCodes = new Set<string>([
  ...CLAIMS_MAIN_CODES,
  ...CLAIMS_COINS_CODES,
  ...CLAIMS_CVRG_CODES
]);
for (const code of claimsCombined.keys()) {
  if (!coveredClaimsCodes.has(code)) {
    throw new Error(`${SOURCE_FILES.claimsCombined} 中的指标 ${code} 未映射到任何指标包`);
  }
}
if (coveredClaimsCodes.size !== claimsCombined.size) {
  throw new Error(`${SOURCE_FILES.claimsCombined} 存在重复映射或缺失映射`);
}

/** 指标包 -> 指标代码 -> SQL 口径。未列出的包（通用包）不附带 SQL。 */
export const METRIC_SQL_BY_PACK: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = Object.freeze({
  RP_RI: Object.freeze(pick(rpRi, RP_RI_CODES, "RP_RI")),
  UW_RI_FAC: Object.freeze(pick(uwFac, UW_FAC_CODES, "UW_RI_FAC", true)),
  CLM_RI_MAIN: Object.freeze(pick(claimsCombined, CLAIMS_MAIN_CODES, "CLM_RI_MAIN")),
  CLM_RI_COINS: Object.freeze(pick(claimsCombined, CLAIMS_COINS_CODES, "CLM_RI_COINS")),
  CLM_RI_FAC: Object.freeze(pick(claimsFac, CLAIMS_FAC_CODES, "CLM_RI_FAC")),
  CLM_RI_CVRG: Object.freeze(pick(claimsCombined, CLAIMS_CVRG_CODES, "CLM_RI_CVRG"))
});
