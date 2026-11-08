import { nowInstant } from "@infra/biz-reconciliation-engine";
import { config } from "../config.js";
import { sanitizeForLog } from "./mask.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface LogFields {
  event: string;
  traceId?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, fields: LogFields): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[config.LOG_LEVEL]) {
    return;
  }
  const payload = {
    level,
    service: "biz-reconciliation",
    instant: nowInstant(),
    ...(sanitizeForLog(fields) as Record<string, unknown>)
  };
  const line = `${JSON.stringify(payload)}\n`;
  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logger = {
  debug: (fields: LogFields): void => write("debug", fields),
  info: (fields: LogFields): void => write("info", fields),
  warn: (fields: LogFields): void => write("warn", fields),
  error: (fields: LogFields): void => write("error", fields)
};
