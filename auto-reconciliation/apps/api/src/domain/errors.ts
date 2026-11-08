import type { ZodIssue } from "zod";

export interface ErrorMeta {
  httpStatus: number;
  retryable: boolean;
  when: string;
}

/**
 * 规范四段式错误码：域_服务_场景_原因。
 * 单文件常量表，handler 只引用常量，禁止字面量散写。
 */
export const ERROR_CODES = {
  BIZ_RECONCILIATION_ROUTE_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "请求的 API 路径未注册"
  },
  BIZ_RECONCILIATION_REQUEST_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    when: "请求体或查询参数未通过 zod 校验"
  },
  BIZ_RECONCILIATION_PACK_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "指标包不存在或已软删除"
  },
  BIZ_RECONCILIATION_PACK_ALREADY_EXISTS: {
    httpStatus: 409,
    retryable: false,
    when: "同一租户下指标包代码已存在"
  },
  BIZ_RECONCILIATION_PACK_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    when: "指标包状态不允许当前操作"
  },
  BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    when: "指标包版本配置未通过 zod 校验或引用不存在的数据集"
  },
  BIZ_RECONCILIATION_PACK_VERSION_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    when: "版本号冲突、版本已发布或非草稿状态"
  },
  BIZ_RECONCILIATION_PACK_VERSION_DRYRUN_FAILED: {
    httpStatus: 422,
    retryable: false,
    when: "L3 发布前的 dryRun 预检失败"
  },
  BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "环境或环境下的系统配置不存在"
  },
  BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT: {
    httpStatus: 409,
    retryable: false,
    when: "环境编码重复、默认环境重复或状态不允许当前操作"
  },
  BIZ_RECONCILIATION_SYSTEM_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "系统不存在或已停用"
  },
  BIZ_RECONCILIATION_PAIR_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "对账关系不存在或已停用"
  },
  BIZ_RECONCILIATION_DATASET_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "数据集不存在或已停用"
  },
  BIZ_RECONCILIATION_DATASET_CONFLICT: {
    httpStatus: 409,
    retryable: false,
    when: "数据集状态不允许当前操作"
  },
  BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    when: "只读 MySQL 未配置、不可达或抽取超时"
  },
  BIZ_RECONCILIATION_IMPORT_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    when: "文件格式、映射配置或行数据非法"
  },
  BIZ_RECONCILIATION_IMPORT_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "导入批次不存在"
  },
  BIZ_RECONCILIATION_RUN_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "对账执行批次不存在"
  },
  BIZ_RECONCILIATION_RUN_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    when: "执行状态不允许取消/重放，或乐观锁版本不一致"
  },
  BIZ_RECONCILIATION_RUN_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    when: "期间非法、指标包未发布或超过单次执行上限"
  },
  BIZ_RECONCILIATION_RUN_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    when: "作业执行器不可用或数据库瞬时不可用"
  },
  BIZ_RECONCILIATION_METRIC_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    when: "指标类型、字段或容差配置非法"
  },
  BIZ_RECONCILIATION_DIFF_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "差异明细不存在"
  },
  BIZ_RECONCILIATION_DIFF_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    when: "差异状态迁移非法或版本号不一致"
  },
  BIZ_RECONCILIATION_ADJUSTMENT_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "调整建议不存在"
  },
  BIZ_RECONCILIATION_ADJUSTMENT_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    when: "调整建议状态迁移非法或版本号不一致"
  },
  BIZ_RECONCILIATION_GATE_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "阶段闸门尚未生成"
  },
  BIZ_RECONCILIATION_GATE_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    when: "闸门未通过却签核，或签核后重跑出现失败"
  },
  BIZ_RECONCILIATION_JOB_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "作业不存在"
  },
  BIZ_RECONCILIATION_JOB_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    when: "作业执行器未启动或队列不可用"
  },
  BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    when: "自动对账配置或执行记录不存在"
  },
  BIZ_RECONCILIATION_AUTOMATION_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    when: "自动对账配置、期间或通知渠道参数非法"
  },
  BIZ_RECONCILIATION_AUTOMATION_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    when: "已有自动对账任务在执行，或同一调度日重复触发"
  },
  BIZ_RECONCILIATION_REPORT_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    when: "报表期间、指标包或导出格式非法"
  },
  BIZ_RECONCILIATION_SERVICE_INTERNAL: {
    httpStatus: 500,
    retryable: true,
    when: "服务端未预期异常"
  }
} as const satisfies Record<string, ErrorMeta>;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly issues?: ZodIssue[];

  public constructor(code: ErrorCode, message: string, issues?: ZodIssue[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.issues = issues;
  }

  public get httpStatus(): number {
    return ERROR_CODES[this.code].httpStatus;
  }

  public get retryable(): boolean {
    return ERROR_CODES[this.code].retryable;
  }
}

export function toErrorEnvelope(
  error: AppError,
  traceId: string
): {
  code: ErrorCode;
  message: string;
  issues?: ZodIssue[];
  traceId: string;
  retryable: boolean;
} {
  const base = {
    code: error.code,
    message: error.message,
    traceId,
    retryable: error.retryable
  };
  return error.issues === undefined ? base : { ...base, issues: error.issues };
}
