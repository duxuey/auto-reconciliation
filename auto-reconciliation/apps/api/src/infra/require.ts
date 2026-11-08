import { AppError } from "../domain/errors.js";

/** Drizzle returning() 在极端情况下可能为空；统一在此转为规范错误 */
export function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new AppError("BIZ_RECONCILIATION_SERVICE_INTERNAL", message);
  }
  return row;
}
