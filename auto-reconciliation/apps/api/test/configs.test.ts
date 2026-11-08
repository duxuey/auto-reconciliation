import { describe, expect, it } from "vitest";
import { EXTRACT_PROFILES } from "@adapter/legacy-mysql";
import {
  datasetMappingSchema,
  parsePackConfig
} from "@infra/biz-reconciliation-engine";
import {
  DATASET_SEEDS,
  ENVIRONMENT_SYSTEM_SEEDS,
  PACK_SEEDS,
  PAIR_SEEDS,
  SYSTEM_SEEDS
} from "../src/seed/configs.js";

describe("种子指标包配置", () => {
  it("数据集映射全部通过 zod 校验", () => {
    for (const dataset of DATASET_SEEDS) {
      expect(() => datasetMappingSchema.parse(dataset.mapping)).not.toThrow();
    }
  });

  it("指标包配置全部通过 zod 校验", () => {
    for (const pack of PACK_SEEDS) {
      expect(() => parsePackConfig(pack.config)).not.toThrow();
    }
  });

  it("指标包引用的数据集均已定义", () => {
    const codes = new Set(DATASET_SEEDS.map((dataset) => dataset.datasetCode));
    for (const pack of PACK_SEEDS) {
      for (const comparison of pack.config.comparisons) {
        for (const reference of [comparison.leftDataset, comparison.rightDataset]) {
          const refs = Array.isArray(reference) ? reference : [reference];
          for (const code of refs) {
            expect(codes.has(code), `${pack.packCode} 引用未定义数据集 ${code}`).toBe(true);
          }
        }
      }
    }
  });

  it("已覆盖会议纪要的系统间指标包", () => {
    const packCodes = PACK_SEEDS.map((pack) => pack.packCode);
    expect(packCodes).toContain("UW_RI_FAC");
    expect(packCodes).toContain("CLM_RI_MAIN");
    expect(packCodes).toContain("CLM_RI_COINS");
    expect(packCodes).toContain("CLM_RI_FAC");
    expect(packCodes).toContain("CLM_RI_CVRG");
    expect(packCodes).toContain("RP_RI");
    expect(packCodes).toContain("NB_UW_CLM_GENERIC");
    expect(packCodes).toHaveLength(7);
  });

  it("系统、对账关系、环境 schema 配置自洽", () => {
    const systemCodes = new Set(SYSTEM_SEEDS.map((item) => item.systemCode));
    expect(systemCodes.size).toBe(SYSTEM_SEEDS.length);

    const pairCodes = new Set(PAIR_SEEDS.map((item) => item.pairCode));
    expect(pairCodes.size).toBe(PAIR_SEEDS.length);
    expect(PAIR_SEEDS).toHaveLength(7);
    for (const pair of PAIR_SEEDS) {
      expect(systemCodes.has(pair.leftSystemCode)).toBe(true);
      expect(systemCodes.has(pair.rightSystemCode)).toBe(true);
    }

    for (const pack of PACK_SEEDS) {
      if (pack.pairCode !== undefined) {
        expect(pairCodes.has(pack.pairCode), `${pack.packCode} 引用未定义对账关系`).toBe(true);
      }
    }

    for (const item of ENVIRONMENT_SYSTEM_SEEDS) {
      expect(systemCodes.has(item.systemCode)).toBe(true);
      expect(Object.keys(item.schemaMap).length).toBeGreaterThan(0);
      for (const schema of Object.values(item.schemaMap)) {
        expect(schema).toMatch(/^[A-Za-z0-9_]+$/);
      }
    }

    for (const dataset of DATASET_SEEDS) {
      if (dataset.systemCode !== undefined) {
        expect(systemCodes.has(dataset.systemCode), `数据集 ${dataset.datasetCode} 系统未定义`).toBe(
          true
        );
      }
    }
  });

  it("只读数据集均登记抽取 profile 且配置业务日期映射", () => {
    for (const dataset of DATASET_SEEDS) {
      if (dataset.transport !== "READONLY_SQL") {
        continue;
      }
      expect(
        dataset.extractProfile,
        `数据集 ${dataset.datasetCode} 未配置抽取 profile`
      ).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(
          EXTRACT_PROFILES,
          dataset.extractProfile as string
        ),
        `数据集 ${dataset.datasetCode} 的抽取 profile ${dataset.extractProfile} 未登记`
      ).toBe(true);
      expect(
        dataset.mapping.businessDate,
        `数据集 ${dataset.datasetCode} 未配置业务日期映射，无法直连查询`
      ).toBeDefined();
    }
  });

  it("指标总数覆盖 55 项", () => {
    const metricCount = PACK_SEEDS.reduce(
      (sum, pack) =>
        sum +
        pack.config.comparisons.reduce(
          (count, comparison) => count + comparison.metrics.length,
          0
        ),
      0
    );
    expect(metricCount).toBe(55);
  });
});
