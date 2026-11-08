import { describe, expect, it } from "vitest";
import {
  AppError,
  ERROR_CODES,
  toErrorEnvelope
} from "../src/domain/errors.js";
import { assertTransition, canTransition } from "../src/domain/status.js";

describe("错误码", () => {
  it("全部为四段式且原因段在词表内", () => {
    const allowed = new Set([
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
    for (const code of Object.keys(ERROR_CODES)) {
      const segments = code.split("_");
      expect(segments.length).toBeGreaterThanOrEqual(4);
      const reason = segments.slice(-2).join("_");
      expect(
        allowed.has(reason) || allowed.has(segments.at(-1) ?? ""),
        `${code} 原因段不在词表`
      ).toBe(true);
    }
  });

  it("HTTP / retryable 映射与错误信封", () => {
    const error = new AppError(
      "BIZ_RECONCILIATION_RUN_NOT_FOUND",
      "执行批次不存在"
    );
    expect(error.httpStatus).toBe(404);
    expect(error.retryable).toBe(false);
    expect(toErrorEnvelope(error, "trace-1")).toMatchObject({
      code: "BIZ_RECONCILIATION_RUN_NOT_FOUND",
      message: "执行批次不存在",
      traceId: "trace-1",
      retryable: false
    });
  });
});

describe("状态迁移", () => {
  it("差异生命周期", () => {
    expect(canTransition("DIFF", "OPEN", "ASSIGNED")).toBe(true);
    expect(canTransition("DIFF", "ASSIGNED", "INVESTIGATING")).toBe(true);
    expect(canTransition("DIFF", "INVESTIGATING", "RESOLVED")).toBe(true);
    expect(canTransition("DIFF", "RESOLVED", "OPEN")).toBe(true);
    expect(canTransition("DIFF", "OPEN", "CLOSED")).toBe(false);
    expect(() => assertTransition("DIFF", "RESOLVED", "ASSIGNED")).toThrow();
  });

  it("闸门只允许从 PASSED 签核", () => {
    expect(canTransition("GATE", "PASSED", "SIGNED_OFF")).toBe(true);
    expect(canTransition("GATE", "BLOCKED", "SIGNED_OFF")).toBe(false);
    expect(canTransition("GATE", "SIGNED_OFF", "BLOCKED")).toBe(true);
  });
});
