import { describe, expect, it } from "vitest";
import type { MappedRecordInput } from "@infra/biz-reconciliation-engine";
import {
  decidePackExecution,
  extractionContentHash,
  extractionSyncKey,
  findDuplicateExternalIds,
  sanitizeExtractionFailure,
  toExclusivePeriodEnd,
  type ExtractionHashInput
} from "../src/application/extraction.js";

function row(overrides: Partial<MappedRecordInput> = {}): MappedRecordInput {
  return {
    externalId: "EXT-1",
    periodCode: "202610",
    businessKey: { policyNo: "P-1" },
    amounts: { premium: "100.00" },
    currency: "CNY",
    businessDate: "2026-10-30",
    recordStatus: null,
    attributes: { channel: "A" },
    raw: { SECRET_COLUMN: "raw-value" },
    ...overrides
  };
}

function hashInput(overrides: Partial<ExtractionHashInput> = {}): ExtractionHashInput {
  return {
    datasetCode: "RP_RI_BILL",
    mappingHash: "map-v1",
    datasourceKey: "env|sys|host:3306|db|schema",
    extractProfile: "RP_RI_BILL",
    periodStartDate: "2026-10-30",
    periodEndDate: "2026-10-30",
    rows: [row()],
    errors: [],
    ...overrides
  };
}

describe("直连抽取期间上界", () => {
  it("单日期间止日 +1 天，匹配 SQL 半开区间", () => {
    expect(toExclusivePeriodEnd("2026-10-30")).toBe("2026-10-31");
  });

  it("跨月/跨年/闰年正确进位", () => {
    expect(toExclusivePeriodEnd("2026-10-31")).toBe("2026-11-01");
    expect(toExclusivePeriodEnd("2026-12-31")).toBe("2027-01-01");
    expect(toExclusivePeriodEnd("2028-02-28")).toBe("2028-02-29");
    expect(toExclusivePeriodEnd("2028-02-29")).toBe("2028-03-01");
  });
});

describe("抽取内容哈希", () => {
  it("行顺序变化不改变内容哈希", () => {
    const a = hashInput({
      rows: [row({ externalId: "A" }), row({ externalId: "B" })]
    });
    const b = hashInput({
      rows: [row({ externalId: "B" }), row({ externalId: "A" })]
    });
    expect(extractionContentHash(a)).toBe(extractionContentHash(b));
    expect(extractionSyncKey(a)).toBe(extractionSyncKey(b));
  });

  it("金额变化会改变内容哈希", () => {
    const a = hashInput();
    const b = hashInput({
      rows: [row({ amounts: { premium: "101.00" } })]
    });
    expect(extractionContentHash(a)).not.toBe(extractionContentHash(b));
    expect(extractionSyncKey(a)).not.toBe(extractionSyncKey(b));
  });

  it("raw 字段不参与哈希", () => {
    const a = hashInput();
    const b = hashInput({
      rows: [row({ raw: { SECRET_COLUMN: "different" } })]
    });
    expect(extractionContentHash(a)).toBe(extractionContentHash(b));
  });

  it("数据源或期间变化会改变批次键", () => {
    const base = hashInput();
    expect(extractionSyncKey(hashInput({ datasourceKey: "other" }))).not.toBe(
      extractionSyncKey(base)
    );
    expect(extractionSyncKey(hashInput({ periodEndDate: "2026-10-31" }))).not.toBe(
      extractionSyncKey(base)
    );
  });

  it("行错误参与哈希", () => {
    const a = hashInput();
    const b = hashInput({ errors: [{ rowNo: 1, message: "业务日期为空" }] });
    expect(extractionContentHash(a)).not.toBe(extractionContentHash(b));
  });
});

describe("重复外部主键", () => {
  it("返回重复键并排序，不含唯一键", () => {
    const duplicates = findDuplicateExternalIds([
      row({ externalId: "B" }),
      row({ externalId: "A" }),
      row({ externalId: "B" }),
      row({ externalId: "A" }),
      row({ externalId: "C" })
    ]);
    expect(duplicates).toEqual(["A", "B"]);
  });

  it("无重复时返回空数组", () => {
    expect(findDuplicateExternalIds([row({ externalId: "A" })])).toEqual([]);
  });
});

describe("指标包执行决策", () => {
  const base = {
    datasetCode: "RP_RI_BILL",
    transport: "READONLY_SQL" as const,
    batchIds: ["batch-1"],
    loaded: 1,
    rejected: 0
  };

  it("有数据时执行，并去重排序批次", () => {
    const decision = decidePackExecution([
      base,
      { ...base, datasetCode: "RP_RI_ACCOUNT", batchIds: ["batch-2", "batch-1"] }
    ]);
    expect(decision).toEqual({
      action: "RUN",
      batchIds: ["batch-1", "batch-2"],
      rejectedRows: 0
    });
  });

  it("两侧都无数据时跳过，标记源库无数据", () => {
    const decision = decidePackExecution([
      { ...base, batchIds: [], loaded: 0 },
      { ...base, datasetCode: "RP_RI_ACCOUNT", batchIds: [], loaded: 0 }
    ]);
    expect(decision).toEqual({ action: "SKIP", reason: "NO_SOURCE_DATA" });
  });

  it("单侧有数据仍执行（产生缺失差异）", () => {
    const decision = decidePackExecution([
      base,
      { ...base, datasetCode: "RP_RI_ACCOUNT", batchIds: [], loaded: 0 }
    ]);
    expect(decision.action).toBe("RUN");
    if (decision.action === "RUN") {
      expect(decision.batchIds).toEqual(["batch-1"]);
    }
  });

  it("抽取异常返回失败而不是无数据", () => {
    const decision = decidePackExecution([
      { ...base, errorMessage: "数据集 RP_RI_BILL 读取源库失败" }
    ]);
    expect(decision).toEqual({
      action: "FAIL",
      message: "数据集 RP_RI_BILL 读取源库失败"
    });
  });

  it("全部行映射失败时失败", () => {
    const decision = decidePackExecution([
      { ...base, batchIds: [], loaded: 0, rejected: 3 }
    ]);
    expect(decision.action).toBe("FAIL");
  });

  it("直接给 UNKNOWN 传输方式的数据集也会按有数据处理", () => {
    const decision = decidePackExecution([
      { ...base, transport: "FILE" }
    ]);
    expect(decision.action).toBe("RUN");
  });
});

describe("抽取失败脱敏", () => {
  it("不泄露 host、账号、密码或驱动原文", () => {
    const error = new Error(
      "Access denied for user 'readonly'@'10.1.2.3' (using password: YES) host=db.internal"
    );
    const message = sanitizeExtractionFailure(error, "RP_RI_BILL");
    expect(message).toContain("RP_RI_BILL");
    expect(message).not.toContain("readonly");
    expect(message).not.toContain("10.1.2.3");
    expect(message).not.toContain("password");
    expect(message).not.toContain("db.internal");
  });
});
