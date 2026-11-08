import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../infra/logger.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const IGNORED = new Set([
  "node_modules",
  "dist",
  ".git",
  "drizzle",
  "test-results",
  "playwright-report",
  "coverage"
]);

interface Violation {
  rule: string;
  file: string;
  detail: string;
}

const violations: Violation[] = [];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx") ||
      entry.name.endsWith(".sql")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkTablePrefix(file: string, content: string): void {
  const matches = content.matchAll(/pgTable\(\s*"([^"]+)"/g);
  for (const match of matches) {
    const tableName = match[1] ?? "";
    if (!tableName.startsWith("biz_reconciliation_")) {
      violations.push({
        rule: "表名必须使用 biz_reconciliation_ 前缀",
        file,
        detail: tableName
      });
    }
  }
}

function checkErrorCodes(file: string, content: string): void {
  const allowedReasons = new Set([
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "INVALID_INPUT",
    "PERMISSION_DENIED",
    "QUOTA_EXCEEDED",
    "CONFLICT",
    "EXPIRED",
    "UNAVAILABLE",
    "DRYRUN_FAILED",
    "INTERNAL"
  ]);
  const matches = content.matchAll(/^\s*(BIZ_RECONCILIATION_[A-Z0-9_]+):/gm);
  for (const match of matches) {
    const code = match[1] ?? "";
    const segments = code.split("_");
    if (segments.length < 4) {
      violations.push({
        rule: "错误码必须四段式",
        file,
        detail: code
      });
      continue;
    }
    const reason = segments.slice(-2).join("_");
    if (!allowedReasons.has(reason) && !allowedReasons.has(segments.at(-1) ?? "")) {
      violations.push({
        rule: "错误码原因段不在规范词表",
        file,
        detail: code
      });
    }
  }
}

function checkSharedNoBusinessTerms(file: string, content: string): void {
  const terms = ["policy", "claim", "treaty", "premium", "保单", "赔案", "再保"];
  const lower = content.toLowerCase();
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) {
      violations.push({
        rule: "共享包禁止出现行业业务术语",
        file,
        detail: term
      });
    }
  }
}

function checkSql(file: string, content: string): void {
  if (/\bsum\s*\(/i.test(content)) {
    violations.push({
      rule: "抽取 SQL 不做金额聚合（SUM）",
      file,
      detail: "SUM("
    });
  }
  const schemas = new Set<string>();
  for (const match of content.matchAll(/(?:from|join)\s+([a-z0-9_]+)\./gi)) {
    schemas.add((match[1] ?? "").toLowerCase());
  }
  if (schemas.size > 1) {
    violations.push({
      rule: "抽取 SQL 禁止跨库",
      file,
      detail: [...schemas].join(",")
    });
  }
}

function checkConsole(file: string, content: string): void {
  if (/console\.(log|debug|info|warn|error)\s*\(/.test(content)) {
    violations.push({
      rule: "禁止 console 入库，统一走 logger",
      file,
      detail: "console"
    });
  }
  if (/\bdebugger\b/.test(content)) {
    violations.push({ rule: "禁止 debugger 入库", file, detail: "debugger" });
  }
}

async function main(): Promise<void> {
  const files = await walk(ROOT);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const relativePath = relative(ROOT, file).replaceAll("\\", "/");
    if (relativePath !== "apps/api/src/scripts/repo-lint.ts") {
      checkConsole(relativePath, content);
    }
    if (relativePath === "apps/api/src/db/schema.ts") {
      checkTablePrefix(relativePath, content);
    }
    if (relativePath === "apps/api/src/domain/errors.ts") {
      checkErrorCodes(relativePath, content);
    }
    if (relativePath.startsWith("packages/shared/")) {
      checkSharedNoBusinessTerms(relativePath, content);
    }
    if (relativePath.startsWith("packages/adapters/legacy-mysql/sql/")) {
      checkSql(relativePath, content);
    }
  }

  if (violations.length > 0) {
    logger.error({ event: "repo-lint.failed", violations });
    process.exitCode = 1;
    return;
  }
  logger.info({ event: "repo-lint.passed", files: files.length });
}

main().catch((error: unknown) => {
  logger.error({
    event: "repo-lint.error",
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
