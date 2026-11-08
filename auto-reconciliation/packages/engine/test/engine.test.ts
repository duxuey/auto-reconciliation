import { describe, expect, it } from "vitest";
import type { NormalizedRecord } from "@shared/types";
import {
  METRIC_SQL_MAX_LENGTH,
  diffMoney,
  exceedsTolerance,
  normalizeMoney,
  parseBusinessDate,
  parseInstant,
  parsePackConfig,
  runPack,
  sumMoney,
  type MetricConfig,
  type PackConfig
} from "../src/index.js";

function record(
  side: "LEFT" | "RIGHT",
  datasetCode: string,
  externalId: string,
  key: Record<string, string>,
  amounts: Record<string, string>,
  attributes: Record<string, string | null> = {}
): NormalizedRecord {
  return {
    side,
    datasetCode,
    sourceSystem: "TEST",
    externalId,
    periodCode: "202610",
    businessKey: key,
    amounts,
    currency: key.currency ?? "CNY",
    businessDate: "2026-10-01",
    recordStatus: "SUCCESS",
    attributes
  };
}

const baseConfig: PackConfig = {
  comparisons: [
    {
      code: "MAIN",
      leftDataset: "L",
      rightDataset: "R",
      keyFields: ["no", "currency"],
      normalize: { upper: ["no"] },
      metrics: [
        { code: "M001", name: "总条数", type: "ROW_COUNT" },
        { code: "M002", name: "业务键数", type: "KEY_COUNT" },
        { code: "M003", name: "左有右无", type: "MISSING_LEFT" },
        { code: "M004", name: "右有左无", type: "MISSING_RIGHT" },
        { code: "M005", name: "同键条数", type: "RECORD_COUNT_PER_KEY" },
        { code: "M006", name: "左侧重复", type: "DUPLICATE_LEFT" },
        { code: "M007", name: "右侧重复", type: "DUPLICATE_RIGHT" },
        {
          code: "M101",
          name: "金额",
          type: "AMOUNT_FIELDS",
          fields: ["amount"],
          tolerance: { abs: "0.00" }
        }
      ]
    }
  ]
};

function sqlConfig(sql: string | undefined): PackConfig {
  const metric: MetricConfig = { code: "M001", name: "总条数", type: "ROW_COUNT" };
  if (sql !== undefined) {
    metric.sql = sql;
  }
  return {
    comparisons: [
      {
        code: "MAIN",
        leftDataset: "L",
        rightDataset: "R",
        keyFields: ["no"],
        metrics: [metric]
      }
    ]
  };
}

describe("指标 SQL 口径（仅文档/审计）", () => {
  it("解析时保留 sql，且允许缺省", () => {
    expect(parsePackConfig(sqlConfig(undefined)).comparisons[0]?.metrics[0]?.sql).toBeUndefined();
    expect(parsePackConfig(sqlConfig("SELECT 1")).comparisons[0]?.metrics[0]?.sql).toBe(
      "SELECT 1"
    );
  });

  it("长度上限为 20000 字符", () => {
    expect(() => parsePackConfig(sqlConfig("x".repeat(METRIC_SQL_MAX_LENGTH)))).not.toThrow();
    expect(() =>
      parsePackConfig(sqlConfig("x".repeat(METRIC_SQL_MAX_LENGTH + 1)))
    ).toThrow();
  });

  it("不执行、不影响结果、不进入执行输出", () => {
    const marker = "__SHOULD_NOT_LEAK__";
    const records: NormalizedRecord[] = [
      record("LEFT", "L", "L1", { no: "A" }, {}),
      record("RIGHT", "R", "R1", { no: "A" }, {})
    ];
    const withoutSql = runPack(sqlConfig(undefined), records);
    const withSql = runPack(sqlConfig(`SELECT '${marker}'`), records);

    expect(withSql).toEqual(withoutSql);
    expect(JSON.stringify(withSql)).not.toContain(marker);
  });
});

describe("money", () => {
  it("归一化与求和", () => {
    expect(normalizeMoney("1.2")).toBe("1.2000");
    expect(sumMoney(["0.1", "0.2"])).toBe("0.3000");
    expect(diffMoney("100.00", "99.99")).toBe("-0.0100");
  });

  it("容差比较", () => {
    expect(exceedsTolerance("100.00", "100.01", { abs: "0.01" })).toBe(false);
    expect(exceedsTolerance("100.00", "100.02", { abs: "0.01" })).toBe(true);
    expect(exceedsTolerance("100.00", "99.00", { abs: "0.00" })).toBe(true);
  });
});

describe("time", () => {
  it("本地时间按业务时区转 UTC", () => {
    expect(parseInstant("2026-10-01 00:00:00", "Asia/Shanghai")).toBe(
      "2026-09-30T16:00:00.000Z"
    );
    expect(parseBusinessDate("2026-10-01 08:30:00", "Asia/Shanghai")).toBe("2026-10-01");
  });
});

describe("metric engine", () => {
  it("按 SQL 口径输出条数、键数、缺失、重复与金额差异", () => {
    const records: NormalizedRecord[] = [
      record("LEFT", "L", "L1", { no: "A", currency: "CNY" }, { amount: "100.00" }),
      record("LEFT", "L", "L2", { no: "B", currency: "CNY" }, { amount: "50.00" }),
      record("LEFT", "L", "L3", { no: "D", currency: "CNY" }, { amount: "10.00" }),
      record("LEFT", "L", "L4", { no: "E", currency: "CNY" }, { amount: "1.00" }),
      record("LEFT", "L", "L5", { no: "E", currency: "CNY" }, { amount: "2.00" }),
      record("RIGHT", "R", "R1", { no: "a", currency: "CNY" }, { amount: "100.00" }),
      record("RIGHT", "R", "R2", { no: "C", currency: "CNY" }, { amount: "30.00" }),
      record("RIGHT", "R", "R3", { no: "D", currency: "CNY" }, { amount: "12.00" })
    ];

    const result = runPack(baseConfig, records);
    const byCode = new Map(result.metrics.map((metric) => [metric.metricCode, metric]));

    expect(byCode.get("M001")).toMatchObject({ totalCount: 5, failCount: 2, checkResult: "FAIL" });
    expect(byCode.get("M002")).toMatchObject({ totalCount: 4, failCount: 1, checkResult: "FAIL" });
    expect(byCode.get("M003")).toMatchObject({ totalCount: 4, failCount: 2, checkResult: "FAIL" });
    expect(byCode.get("M004")).toMatchObject({ totalCount: 3, failCount: 1, checkResult: "FAIL" });
    expect(byCode.get("M005")).toMatchObject({ failCount: 0, checkResult: "PASS" });
    expect(byCode.get("M006")).toMatchObject({ failCount: 1, checkResult: "FAIL" });
    expect(byCode.get("M007")).toMatchObject({ failCount: 0, checkResult: "PASS" });
    expect(byCode.get("M101")).toMatchObject({ totalCount: 2, failCount: 1, checkResult: "FAIL" });

    const amountDiff = result.diffs.find(
      (diff) => diff.metricCode === "M101" && diff.fieldCode === "amount"
    );
    expect(amountDiff).toMatchObject({
      businessKeyText: "CNY|D",
      leftValue: "10.0000",
      rightValue: "12.0000",
      diffValue: "2.0000"
    });
  });

  it("按规则执行 claim_type=4 的互换取负", () => {
    const config: PackConfig = {
      comparisons: [
        {
          code: "CLM",
          leftDataset: "L",
          rightDataset: "R",
          keyFields: ["no", "currency"],
          rightRules: [
            {
              when: { claim_type: { equals: "4" } },
              swapNegate: [
                ["outst", "settled"],
                ["rmb_outst", "rmb_settled"]
              ]
            }
          ],
          metrics: [
            {
              code: "M101",
              name: "未决",
              type: "AMOUNT_FIELDS",
              fields: ["outst", "rmb_outst"]
            },
            {
              code: "M102",
              name: "已决",
              type: "AMOUNT_FIELDS",
              fields: ["settled", "rmb_settled"]
            }
          ]
        }
      ]
    };

    const records: NormalizedRecord[] = [
      record(
        "LEFT",
        "L",
        "L1",
        { no: "A", currency: "CNY" },
        { outst: "100.00", settled: "0.00", rmb_outst: "100.00", rmb_settled: "0.00" },
        { claim_type: "4" }
      ),
      record(
        "RIGHT",
        "R",
        "R1",
        { no: "A", currency: "CNY" },
        { outst: "0.00", settled: "-100.00", rmb_outst: "0.00", rmb_settled: "-100.00" },
        { claim_type: "4" }
      )
    ];

    const result = runPack(config, records);
    expect(result.metrics.find((metric) => metric.metricCode === "M101")?.checkResult).toBe("PASS");
    expect(result.metrics.find((metric) => metric.metricCode === "M102")?.checkResult).toBe("PASS");
  });

  it("左侧缺失且金额为负时差异值为合法十进制", () => {
    const records: NormalizedRecord[] = [
      record("LEFT", "L", "L1", { no: "NEG", currency: "CNY" }, { amount: "-100848.73" })
    ];

    const result = runPack(baseConfig, records);
    const missing = result.diffs.filter((diff) => diff.diffType === "MISSING_LEFT");

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      leftValue: "-100848.7300",
      rightValue: "0.0000",
      diffValue: "100848.7300"
    });
    expect(missing[0]?.diffValue).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it("零金额维度剔除，但命中例外时保留", () => {
    const config: PackConfig = {
      comparisons: [
        {
          code: "CVRG",
          leftDataset: "L",
          rightDataset: "R",
          keyFields: ["no", "currency"],
          zeroSkip: {
            fields: ["amount"],
            exceptions: [{ side: "LEFT", field: "source", in: ["190"] }]
          },
          metrics: [{ code: "M001", name: "金额", type: "AMOUNT_FIELDS", fields: ["amount"] }]
        }
      ]
    };

    const records: NormalizedRecord[] = [
      record("LEFT", "L", "L1", { no: "ZERO", currency: "CNY" }, { amount: "0.00" }),
      record("RIGHT", "R", "R1", { no: "ZERO", currency: "CNY" }, { amount: "0.00" }),
      record("LEFT", "L", "L2", { no: "KEEP", currency: "CNY" }, { amount: "0.00" }, { source: "190" }),
      record("RIGHT", "R", "R2", { no: "KEEP", currency: "CNY" }, { amount: "1.00" })
    ];

    const result = runPack(config, records);
    expect(result.metrics[0]?.totalCount).toBe(1);
  });
});
