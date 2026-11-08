import { zValidator } from "@hono/zod-validator";
import type { ZodTypeAny } from "zod";
import { AppError, type ErrorCode } from "../domain/errors.js";

type Target = "json" | "query" | "param";

function validator<T extends ZodTypeAny>(target: Target, schema: T, code: ErrorCode) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new AppError(code, "请求参数校验失败", result.error.issues);
    }
  });
}

export function jsonValidator<T extends ZodTypeAny>(schema: T, code: ErrorCode) {
  return validator("json", schema, code);
}

export function queryValidator<T extends ZodTypeAny>(schema: T, code: ErrorCode) {
  return validator("query", schema, code);
}

export function paramValidator<T extends ZodTypeAny>(schema: T, code: ErrorCode) {
  return validator("param", schema, code);
}
