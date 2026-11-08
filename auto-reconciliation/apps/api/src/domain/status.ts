import { AppError, type ErrorCode } from "./errors.js";

export const PACK_STATUS = ["DRAFT", "ACTIVE", "INACTIVE"] as const;
export type PackStatus = (typeof PACK_STATUS)[number];

export const PACK_VERSION_STATUS = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export type PackVersionStatus = (typeof PACK_VERSION_STATUS)[number];

export const IMPORT_STATUS = ["PENDING", "VALIDATING", "LOADED", "PARTIAL", "FAILED"] as const;
export type ImportStatus = (typeof IMPORT_STATUS)[number];

export const RUN_STATUS = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type RunStatus = (typeof RUN_STATUS)[number];

export const DIFF_STATUS = [
  "OPEN",
  "ASSIGNED",
  "INVESTIGATING",
  "RESOLVED",
  "WRITTEN_OFF"
] as const;
export type DiffStatus = (typeof DIFF_STATUS)[number];

export const ADJUSTMENT_STATUS = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "EXPORTED"
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUS)[number];

export const GATE_STATUS = ["PENDING", "PASSED", "BLOCKED", "SIGNED_OFF"] as const;
export type GateStatus = (typeof GATE_STATUS)[number];

export const JOB_STATUS = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

const TRANSITIONS: Record<string, Record<string, readonly string[]>> = {
  PACK: {
    DRAFT: ["ACTIVE"],
    ACTIVE: ["INACTIVE"],
    INACTIVE: ["ACTIVE"]
  },
  PACK_VERSION: {
    DRAFT: ["PUBLISHED", "RETIRED"],
    PUBLISHED: ["RETIRED"],
    RETIRED: []
  },
  IMPORT: {
    PENDING: ["VALIDATING", "FAILED"],
    VALIDATING: ["LOADED", "PARTIAL", "FAILED"],
    LOADED: [],
    PARTIAL: [],
    FAILED: []
  },
  RUN: {
    PENDING: ["RUNNING", "CANCELLED"],
    RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: []
  },
  DIFF: {
    OPEN: ["ASSIGNED", "INVESTIGATING", "RESOLVED", "WRITTEN_OFF"],
    ASSIGNED: ["INVESTIGATING", "RESOLVED", "WRITTEN_OFF"],
    INVESTIGATING: ["RESOLVED", "WRITTEN_OFF"],
    RESOLVED: ["OPEN"],
    WRITTEN_OFF: ["OPEN"]
  },
  ADJUSTMENT: {
    DRAFT: ["SUBMITTED"],
    SUBMITTED: ["APPROVED", "REJECTED"],
    APPROVED: ["EXPORTED"],
    REJECTED: [],
    EXPORTED: []
  },
  GATE: {
    PENDING: ["PASSED", "BLOCKED"],
    PASSED: ["SIGNED_OFF", "BLOCKED"],
    BLOCKED: ["PASSED"],
    SIGNED_OFF: ["BLOCKED"]
  },
  JOB: {
    QUEUED: ["RUNNING", "CANCELLED"],
    RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: []
  }
};

const CONFLICT_CODE: Record<string, ErrorCode> = {
  PACK: "BIZ_RECONCILIATION_PACK_CONFLICT",
  PACK_VERSION: "BIZ_RECONCILIATION_PACK_VERSION_CONFLICT",
  IMPORT: "BIZ_RECONCILIATION_IMPORT_INVALID_INPUT",
  RUN: "BIZ_RECONCILIATION_RUN_CONFLICT",
  DIFF: "BIZ_RECONCILIATION_DIFF_CONFLICT",
  ADJUSTMENT: "BIZ_RECONCILIATION_ADJUSTMENT_CONFLICT",
  GATE: "BIZ_RECONCILIATION_GATE_CONFLICT",
  JOB: "BIZ_RECONCILIATION_JOB_UNAVAILABLE"
};

export function canTransition(entity: string, from: string, to: string): boolean {
  return (TRANSITIONS[entity]?.[from] ?? []).includes(to);
}

export function assertTransition(entity: string, from: string, to: string): void {
  if (!canTransition(entity, from, to)) {
    const code = CONFLICT_CODE[entity] ?? "BIZ_RECONCILIATION_SERVICE_INTERNAL";
    throw new AppError(code, `${entity} 状态不允许从 ${from} 迁移到 ${to}`);
  }
}
