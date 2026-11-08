export type AutomationTriggerType = "SCHEDULE" | "CATCH_UP" | "MANUAL";

export type AutomationRunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED";

export type NotifyStatus = "PENDING" | "SENT" | "PARTIAL" | "FAILED" | "SKIPPED";

/** WEBHOOK=企业微信群机器人；APP=企业应用私聊；ROBOT=飞书/钉钉等群机器人；BOTH=群机器人+企业应用 */
export type NotifyChannel = "WEBHOOK" | "APP" | "BOTH" | "ROBOT";

export interface AutomationPeriod {
  /** 调度日（定时/补跑）或期间止日（手动） */
  businessDate: string;
  periodStartDate: string;
  periodEndDate: string;
}

export interface AutomationRunSummaryItem {
  runId: string;
  runNo: string;
  packCode: string;
  packName: string;
  runStatus: string;
  metricTotal: number;
  failMetricCount: number;
  diffCount: number;
  reused: boolean;
}

export type AutomationPairStatus = "SUCCEEDED" | "PARTIAL" | "NO_DATA" | "FAILED";

export interface AutomationPairSummary {
  pairId: string;
  pairCode: string;
  pairName: string;
  environmentId: string;
  status: AutomationPairStatus;
  createdCount: number;
  reusedCount: number;
  skippedCount: number;
  failedCount: number;
  metricTotal: number;
  failMetricCount: number;
  diffCount: number;
  runs: AutomationRunSummaryItem[];
  skippedPacks: Array<{ packCode: string; reason: string }>;
  failedPacks: Array<{ packCode: string; message: string }>;
}

export interface AutomationFailedMetric {
  runId: string;
  packCode: string;
  packName: string;
  metricCode: string;
  metricName: string;
  failCount: number;
}

export interface AutomationSummary {
  pairCount: number;
  pairExecutedCount: number;
  pairNoDataCount: number;
  pairFailedCount: number;
  batchCount: number;
  batchReusedCount: number;
  batchSucceededCount: number;
  batchFailedCount: number;
  metricTotal: number;
  failMetricCount: number;
  diffCount: number;
  pairs: AutomationPairSummary[];
  failedMetrics: AutomationFailedMetric[];
}
