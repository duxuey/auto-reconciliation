import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { METRIC_SQL_MAX_LENGTH } from "@infra/biz-reconciliation-engine";
import {
  METRIC_SQL_BY_PACK,
  parseDelimitedMetricSql,
  parseRpMetricSql,
  parseUwFacMetricSql
} from "../src/seed/metric-sql.js";

const SOURCE_DIR = new URL("../src/seed/metric-sql/", import.meta.url);

function readSource(fileName: string): string {
  return readFileSync(new URL(fileName, SOURCE_DIR), "utf8");
}

const CREDENTIAL_PATTERN = /password|passwd|pwd|jdbc:|mysql:\/\/|secret|token/i;

describe("指标 SQL 源解析", () => {
  it("综合理赔脚本解析 23 个指标，并容错 M301 缺失注释头", () => {
    const parsed = parseDelimitedMetricSql(
      readSource("claims-combined.sql"),
      "claims-combined.sql"
    );
    expect(parsed.size).toBe(23);
    expect(parsed.has("M301")).toBe(true);
    for (const code of ["M001", "M008", "M109", "M201", "M209", "M301", "M303"]) {
      expect(parsed.has(code), `缺少 ${code}`).toBe(true);
    }
    const m301 = parsed.get("M301");
    expect(m301).toBeDefined();
    expect(m301?.startsWith("-- 指标 SQL 口径")).toBe(true);
    expect(m301).toContain("SET @begin_time");
    expect(m301).toContain("WITH");
    expect(m301?.trimEnd().endsWith(";")).toBe(true);
  });

  it("临分分入理赔脚本解析 11 个指标", () => {
    const parsed = parseDelimitedMetricSql(readSource("claims-fac.sql"), "claims-fac.sql");
    expect([...parsed.keys()].sort()).toEqual([
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
    ]);
    expect(parsed.get("M001")).toContain("SET @ifac_begin_time");
  });

  it("收付脚本只映射 SQL 2/3/4，不包含辅助 SQL 1", () => {
    const parsed = parseRpMetricSql(readSource("rp-ri.sql"), "rp-ri.sql");
    expect([...parsed.keys()]).toEqual(["M001", "M002", "M003"]);
    expect(parsed.get("M001")).toContain("SET @start_time");
    expect(parsed.get("M001")).not.toContain("ORDER BY ri_biz_type, c_prtc_mark, c_rp_batch_no;");
    expect(parsed.get("M001")).not.toContain("RI_MISSING_IN_RP");
    expect(parsed.get("M003")).toContain("RI_MISSING_IN_RP");
  });

  it("承保单语句按指标拆分，分支之间不串用", () => {
    const parsed = parseUwFacMetricSql(readSource("uw-fac.sql"), "uw-fac.sql");
    expect(parsed.size).toBe(11);

    const m001 = parsed.get("M001");
    expect(m001).toBeDefined();
    expect(m001).not.toContain("amt_diff_rows");
    expect(m001).not.toContain("'业务键数量是否一致'");
    // 只保留来源注释，脚本自身的文件头说明不应出现在指标 SQL 中。
    expect(m001?.replace(/^(?:--.*\n)+/, "").startsWith("WITH")).toBe(true);

    const m102 = parsed.get("M102");
    expect(m102).toBeDefined();
    expect(m102).toContain("'M102'");
    expect(m102).toContain("amt_diff_rows");
    expect(m102).not.toContain("'保额类金额是否一致'");
  });

  it("所有指标 SQL 长度合规、结构完整且不含凭据", () => {
    const all = Object.values(METRIC_SQL_BY_PACK).flatMap((codes) => Object.entries(codes));
    expect(all).toHaveLength(48);
    for (const [code, sql] of all) {
      expect(sql.trim(), code).not.toBe("");
      expect(sql.length, code).toBeLessThanOrEqual(METRIC_SQL_MAX_LENGTH);
      expect(sql, code).toMatch(/^-- 指标 SQL 口径/);
      expect(sql, code).toContain("WITH");
      expect(sql.trimEnd(), code).toMatch(/;$/);
      expect(sql, code).not.toMatch(CREDENTIAL_PATTERN);
    }
  });

  it("源文件不含凭据关键字", () => {
    for (const fileName of [
      "claims-combined.sql",
      "claims-fac.sql",
      "uw-fac.sql",
      "rp-ri.sql"
    ]) {
      expect(readSource(fileName), fileName).not.toMatch(CREDENTIAL_PATTERN);
    }
  });
});
