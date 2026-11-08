import { describe, expect, it } from "vitest";
import {
  computeLatestDueScheduleDate,
  computeNextRunAt
} from "../src/application/automation-schedule.js";

const ZONE = "Asia/Shanghai";

describe("computeNextRunAt", () => {
  it("当天执行时间未到，安排当天", () => {
    expect(
      computeNextRunAt("08:30", ZONE, "2026-11-07T00:00:00.000Z")
    ).toBe("2026-11-07T00:30:00.000Z");
  });

  it("当天执行时间已过，安排次日", () => {
    expect(
      computeNextRunAt("08:30", ZONE, "2026-11-07T00:30:00.000Z")
    ).toBe("2026-11-08T00:30:00.000Z");
    expect(
      computeNextRunAt("08:30", ZONE, "2026-11-07T12:00:00.000Z")
    ).toBe("2026-11-08T00:30:00.000Z");
  });

  it("跨月/跨年时日期正确进位", () => {
    expect(
      computeNextRunAt("08:30", ZONE, "2026-12-31T12:00:00.000Z")
    ).toBe("2027-01-01T00:30:00.000Z");
  });

  it("UTC 前一日但仍属业务当日时按业务时区判断", () => {
    // 2026-11-06T23:00Z = 2026-11-07 07:00 Asia/Shanghai，08:30 未到
    expect(
      computeNextRunAt("08:30", ZONE, "2026-11-06T23:00:00.000Z")
    ).toBe("2026-11-07T00:30:00.000Z");
  });
});

describe("computeLatestDueScheduleDate", () => {
  it("当天执行时间已到返回当天", () => {
    expect(
      computeLatestDueScheduleDate("08:30", ZONE, "2026-11-07T00:30:00.000Z")
    ).toBe("2026-11-07");
    expect(
      computeLatestDueScheduleDate("08:30", ZONE, "2026-11-07T10:00:00.000Z")
    ).toBe("2026-11-07");
  });

  it("当天执行时间未到返回前一日", () => {
    expect(
      computeLatestDueScheduleDate("08:30", ZONE, "2026-11-07T00:29:59.000Z")
    ).toBe("2026-11-06");
  });

  it("跨年边界返回上一年最后一天", () => {
    expect(
      computeLatestDueScheduleDate("08:30", ZONE, "2027-01-01T00:00:00.000Z")
    ).toBe("2026-12-31");
  });
});
