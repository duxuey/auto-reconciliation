import { describe, expect, it } from "vitest";
import {
  diffMetricChanges,
  readPackConfig,
  updateMetricSql,
  type PackConfig,
  type PackMetricConfig
} from "./pack-config";

function metric(code: string, sql?: string): PackMetricConfig {
  const result: PackMetricConfig = { code, name: code, type: "ROW_COUNT" };
  if (sql !== undefined) {
    result.sql = sql;
  }
  return result;
}

function config(metrics: PackMetricConfig[]): PackConfig {
  return {
    comparisons: [
      { code: "C1", leftDataset: "L", rightDataset: "R", keyFields: ["k"], metrics }
    ]
  };
}

describe("readPackConfig / readMetric", () => {
  it("保留字符串 sql，缺失保持 undefined", () => {
    const parsed = readPackConfig({
      comparisons: [
        {
          code: "C1",
          leftDataset: "L",
          rightDataset: "R",
          keyFields: ["k"],
          metrics: [
            { code: "M001", name: "A", type: "ROW_COUNT", sql: "SELECT 1" },
            { code: "M002", name: "B", type: "ROW_COUNT" }
          ]
        }
      ]
    });
    expect(parsed?.comparisons[0]?.metrics[0]?.sql).toBe("SELECT 1");
    expect(parsed?.comparisons[0]?.metrics[1]?.sql).toBeUndefined();
  });

  it("非字符串 sql 归一化为 undefined", () => {
    for (const value of [123, null, { text: "x" }]) {
      const parsed = readPackConfig({
        comparisons: [
          {
            code: "C1",
            leftDataset: "L",
            rightDataset: "R",
            keyFields: ["k"],
            metrics: [{ code: "M001", name: "A", type: "ROW_COUNT", sql: value }]
          }
        ]
      });
      expect(parsed?.comparisons[0]?.metrics[0]?.sql).toBeUndefined();
    }
  });
});

describe("updateMetricSql", () => {
  it("写入目标指标且不修改原配置", () => {
    const base = config([metric("M001"), metric("M002")]);
    const next = updateMetricSql(base, 0, 1, "SELECT 2");

    expect(next.comparisons[0]?.metrics[1]?.sql).toBe("SELECT 2");
    expect(next.comparisons[0]?.metrics[0]?.sql).toBeUndefined();
    expect(base.comparisons[0]?.metrics[1]?.sql).toBeUndefined();
  });

  it("空字符串与纯空白删除 sql 字段", () => {
    for (const value of ["", "   \n\t "]) {
      const next = updateMetricSql(config([metric("M001", "SELECT 1")]), 0, 0, value);
      const target = next.comparisons[0]?.metrics[0];
      expect(target === undefined).toBe(false);
      expect(target !== undefined && "sql" in target).toBe(false);
    }
  });

  it("多行 SQL 原样保留", () => {
    const sql = "SELECT id\n  FROM t\n WHERE dt >= ?";
    const next = updateMetricSql(config([metric("M001")]), 0, 0, sql);
    expect(next.comparisons[0]?.metrics[0]?.sql).toBe(sql);
  });

  it("索引越界时返回等价克隆", () => {
    const base = config([metric("M001", "SELECT 1")]);
    expect(updateMetricSql(base, 9, 0, "x")).toEqual(base);
    expect(updateMetricSql(base, 0, 9, "x")).toEqual(base);
  });
});

describe("diffMetricChanges", () => {
  it("仅修改 SQL 计入 modified", () => {
    const changes = diffMetricChanges(
      config([metric("M001", "SELECT 1")]),
      config([metric("M001", "SELECT 2")])
    );
    expect(changes).toMatchObject({
      added: 0,
      removed: 0,
      modified: 1,
      modifiedCodes: ["C1::M001"]
    });
  });

  it("相同 SQL 不计差异", () => {
    const changes = diffMetricChanges(
      config([metric("M001", "SELECT 1")]),
      config([metric("M001", "SELECT 1")])
    );
    expect(changes.modified).toBe(0);
  });

  it("缺失与空字符串等价", () => {
    const changes = diffMetricChanges(config([metric("M001")]), config([metric("M001", "")]));
    expect(changes.modified).toBe(0);
  });

  it("清空已有 SQL 计入 modified", () => {
    const changes = diffMetricChanges(
      config([metric("M001", "SELECT 1")]),
      config([metric("M001", "")])
    );
    expect(changes.modified).toBe(1);
  });

  it("新增带 SQL 只计 added，移除只计 removed", () => {
    const added = diffMetricChanges(
      config([metric("M001")]),
      config([metric("M001"), metric("M002", "SELECT 2")])
    );
    expect(added).toMatchObject({ added: 1, removed: 0, modified: 0 });
    expect(added.addedCodes).toEqual(["C1::M002"]);

    const removed = diffMetricChanges(
      config([metric("M001"), metric("M002", "SELECT 2")]),
      config([metric("M001")])
    );
    expect(removed).toMatchObject({ added: 0, removed: 1, modified: 0 });
    expect(removed.removedCodes).toEqual(["C1::M002"]);
  });

  it("增、删、改同时出现时计数独立", () => {
    const changes = diffMetricChanges(
      config([metric("M001", "a"), metric("M002"), metric("M003")]),
      config([metric("M001", "b"), metric("M002"), metric("M004", "SELECT 4")])
    );
    expect(changes).toMatchObject({ added: 1, removed: 1, modified: 1 });
    expect(changes.addedCodes).toEqual(["C1::M004"]);
    expect(changes.removedCodes).toEqual(["C1::M003"]);
    expect(changes.modifiedCodes).toEqual(["C1::M001"]);
  });
});
