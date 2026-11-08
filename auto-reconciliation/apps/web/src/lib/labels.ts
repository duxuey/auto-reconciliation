export type BadgeTone = "success" | "danger" | "warning" | "info" | "neutral";

export const RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "执行失败",
  CANCELLED: "已取消"
};

export const DIFF_STATUS_LABELS: Record<string, string> = {
  OPEN: "待处理",
  ASSIGNED: "已指派",
  INVESTIGATING: "处理中",
  RESOLVED: "已解决",
  WRITTEN_OFF: "已核销"
};

export const ADJUSTMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "待审批",
  APPROVED: "已审批",
  REJECTED: "已驳回",
  EXPORTED: "已导出"
};

export const GATE_STATUS_LABELS: Record<string, string> = {
  PENDING: "等待执行",
  PASSED: "可放行",
  BLOCKED: "存在阻断",
  SIGNED_OFF: "已签核"
};

export const METRIC_RESULT_LABELS: Record<string, string> = {
  PASS: "通过",
  FAIL: "不通过"
};

export const IMPORT_STATUS_LABELS: Record<string, string> = {
  PENDING: "排队中",
  VALIDATING: "校验中",
  LOADED: "已就绪",
  PARTIAL: "部分导入",
  FAILED: "导入失败"
};

export const TRANSPORT_LABELS: Record<string, string> = {
  FILE: "文件上传",
  READONLY_SQL: "直连源库"
};

export const CHECK_STAGE_LABELS: Record<string, string> = {
  INTERFACE: "系统间",
  PRE_BOOKING: "记账前",
  POST_BOOKING: "记账后"
};

export const RUN_MODE_LABELS: Record<string, string> = {
  FULL: "正式执行",
  DRY_RUN: "试运行"
};

export const PACK_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "启用",
  INACTIVE: "停用"
};

export const PACK_VERSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  RETIRED: "已停用"
};

export const RESOLUTION_TYPE_LABELS: Record<string, string> = {
  DATA_FIX: "数据修正",
  SUPPLEMENT_RECEIPT: "补收",
  SUPPLEMENT_PAYMENT: "补付",
  REVERSAL: "冲销",
  CONFIRM_WRITE_OFF: "确认核销"
};

export const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  DATA_FIX: "数据修正",
  SUPPLEMENT_RECEIPT: "补收",
  SUPPLEMENT_PAYMENT: "补付",
  REVERSAL: "冲销",
  CONFIRM_WRITE_OFF: "确认核销"
};

export const METRIC_TYPE_LABELS: Record<string, string> = {
  ROW_COUNT: "记录数",
  KEY_COUNT: "业务键数",
  MISSING_LEFT: "左侧缺失",
  MISSING_RIGHT: "右侧缺失",
  MISSING_BOTH: "双侧缺失",
  RECORD_COUNT_PER_KEY: "同键记录数",
  DUPLICATE_LEFT: "左侧重复",
  DUPLICATE_RIGHT: "右侧重复",
  SOURCE_ANOMALY: "来源异常",
  AMOUNT_FIELDS: "金额字段",
  RATE_FIELD: "汇率字段"
};

export const DIFF_TYPE_LABELS: Record<string, string> = {
  AMOUNT_MISMATCH: "金额不一致",
  MISSING_LEFT: "左侧缺失",
  MISSING_RIGHT: "右侧缺失",
  MISSING_BOTH: "双侧缺失",
  DUPLICATE: "重复记录",
  RECORD_COUNT_MISMATCH: "同键记录数不一致",
  SOURCE_ANOMALY: "来源异常"
};

export const AUTOMATION_RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "成功",
  PARTIAL: "部分失败",
  FAILED: "失败"
};

export const AUTOMATION_PAIR_STATUS_LABELS: Record<string, string> = {
  SUCCEEDED: "成功",
  PARTIAL: "部分失败",
  NO_DATA: "源库期间内无数据",
  FAILED: "失败"
};

export const AUTOMATION_NOTIFY_STATUS_LABELS: Record<string, string> = {
  PENDING: "待发送",
  SENT: "已发送",
  PARTIAL: "部分发送",
  FAILED: "发送失败",
  SKIPPED: "未发送"
};

export const AUTOMATION_TRIGGER_LABELS: Record<string, string> = {
  SCHEDULE: "定时",
  CATCH_UP: "启动补跑",
  MANUAL: "手动"
};

export const AUTOMATION_CHANNEL_LABELS: Record<string, string> = {
  WEBHOOK: "企业微信群机器人（发到群）",
  ROBOT: "飞书/钉钉机器人（发到群并 @成员）",
  APP: "企业应用私聊（指定成员）",
  BOTH: "企业微信群机器人 + 应用私聊"
};

export const READINESS_STATUS_LABELS: Record<string, string> = {
  READY: "已就绪",
  MISSING: "未接入",
  PARTIAL: "部分导入",
  FAILED: "接入失败",
  STALE: "暂无期间数据",
  PROCESSING: "同步中",
  NO_EXTRACT: "未配置读库",
  NO_DATASOURCE: "源库未配置",
  NO_DATASET: "数据集缺失"
};

const SUCCESS_CODES = new Set([
  "PASS",
  "SUCCEEDED",
  "PASSED",
  "SIGNED_OFF",
  "LOADED",
  "READY",
  "ACTIVE",
  "PUBLISHED",
  "APPROVED",
  "EXPORTED"
]);
const DANGER_CODES = new Set([
  "FAIL",
  "FAILED",
  "BLOCKED",
  "NO_DATASET",
  "NO_EXTRACT",
  "NO_DATASOURCE"
]);
const WARNING_CODES = new Set([
  "PARTIAL",
  "RUNNING",
  "PENDING",
  "OPEN",
  "ASSIGNED",
  "INVESTIGATING",
  "SUBMITTED",
  "DRAFT",
  "MISSING",
  "STALE",
  "PROCESSING"
]);

export function labelOf(
  map: Record<string, string>,
  code: string | null | undefined,
  fallback = "-"
): string {
  if (code === null || code === undefined || code === "") {
    return fallback;
  }
  return map[code] ?? code;
}

export function statusTone(code: string | null | undefined): BadgeTone {
  if (code === null || code === undefined) {
    return "neutral";
  }
  if (SUCCESS_CODES.has(code)) {
    return "success";
  }
  if (DANGER_CODES.has(code)) {
    return "danger";
  }
  if (WARNING_CODES.has(code)) {
    return "warning";
  }
  return "neutral";
}

export function diffTypeLabel(code: string | null | undefined): string {
  if (code === null || code === undefined) {
    return "-";
  }
  if (code.startsWith("SOURCE_ANOMALY")) {
    return "来源异常";
  }
  return DIFF_TYPE_LABELS[code] ?? code;
}
