import { describe, expect, it } from "vitest";
import {
  addDaysToBusinessDate,
  businessDateOfInstant,
  businessDateTimeInstant,
  millisecondsUntil,
  nowEpochMs
} from "../src/index.js";

describe("业务日期加减", () => {
  it("支持 T-1 与跨月、跨年", () => {
    expect(addDaysToBusinessDate("2026-11-07", -1)).toBe("2026-11-06");
    expect(addDaysToBusinessDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToBusinessDate("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDaysToBusinessDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToBusinessDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("业务时区换算", () => {
  it("按 Asia/Shanghai 取业务日期", () => {
    expect(businessDateOfInstant("2026-11-06T15:59:59.000Z")).toBe("2026-11-06");
    expect(businessDateOfInstant("2026-11-06T16:00:00.000Z")).toBe("2026-11-07");
  });

  it("业务日期 + HH:mm 转 UTC 时刻", () => {
    expect(businessDateTimeInstant("2026-11-07", "08:30")).toBe(
      "2026-11-07T00:30:00.000Z"
    );
    expect(businessDateTimeInstant("2026-11-07", "23:59")).toBe(
      "2026-11-07T15:59:00.000Z"
    );
  });
});

describe("时间距离", () => {
  it("已过期返回负数", () => {
    expect(
      millisecondsUntil("2026-11-07T00:00:00.000Z", "2026-11-07T00:01:00.000Z")
    ).toBe(-60_000);
    expect(
      millisecondsUntil("2026-11-07T00:01:30.000Z", "2026-11-07T00:00:00.000Z")
    ).toBe(90_000);
  });

  it("nowEpochMs 返回当前毫秒时间戳", () => {
    const before = nowEpochMs();
    const value = nowEpochMs();
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(before);
    // 2026-01-01 之后，避免依赖本机时钟精度
    expect(value).toBeGreaterThan(1_767_225_600_000);
  });
});
