import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import {
  addDaysToBusinessDate,
  businessToday
} from "@infra/biz-reconciliation-engine";
import { truncate } from "@shared/utils";
import { config, readSecret } from "../config.js";
import { db } from "../db/client.js";
import {
  automationConfig,
  automationRun,
  checkDiff,
  checkMetricResult,
  checkRun
} from "../db/schema.js";
import type {
  AutomationFailedMetric,
  AutomationPairStatus,
  AutomationPairSummary,
  AutomationPeriod,
  AutomationRunStatus,
  AutomationSummary,
  AutomationTriggerType,
  NotifyChannel,
  NotifyStatus
} from "../domain/automation.js";
import { AppError } from "../domain/errors.js";
import { logger } from "../infra/logger.js";
import {
  sendRobotWebhook,
  type RobotSendResult
} from "../infra/robot-webhook.js";
import {
  sendWecomApp,
  sendWecomWebhook,
  truncateUtf8ByLines,
  type WecomSendResult
} from "../infra/wecom.js";
import { getEnvironmentById, listPairs, resolveEnvironment } from "./environments.js";
import type { ExtractDatasetResult } from "./imports.js";
import { createRunsForPair, type CreateRunsForPairResult } from "./runs.js";

export type AutomationRunRow = typeof automationRun.$inferSelect;

const AUTOMATION_ACTOR = "agent:automation";
const WEBHOOK_MAX_BYTES = 4096;
const APP_MAX_BYTES = 2048;

export interface AutomationConfigInput {
  enabled: boolean;
  runTime: string;
  channel: NotifyChannel;
  environmentId: string;
  webhookUrlEnvKey: string;
  appCorpId?: string | null;
  appAgentId?: string | null;
  appSecretEnvKey: string;
  toUser?: string | null;
}

export interface AutomationConfigView extends AutomationConfigInput {
  id: string | null;
  webhookConfigured: boolean;
  appSecretConfigured: boolean;
  appFieldsConfigured: boolean;
  defaultPeriodStartDate: string;
  defaultPeriodEndDate: string;
}

export interface StartAutomationRunInput {
  triggerType: AutomationTriggerType;
  period: AutomationPeriod;
  runKey: string;
  actor: string;
  notify?: boolean;
}

let activeRun: Promise<unknown> | null = null;

export function isAutomationRunning(): boolean {
  return activeRun !== null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function envConfigured(envKey: string): boolean {
  const value = readSecret(envKey);
  return value !== undefined && value.trim() !== "";
}

/** T-1 期间（手动默认值） */
export function resolveDefaultManualPeriod(): AutomationPeriod {
  const today = businessToday(config.BUSINESS_TIME_ZONE);
  const previous = addDaysToBusinessDate(today, -1);
  return { businessDate: previous, periodStartDate: previous, periodEndDate: previous };
}

/** 调度日对应的对账期间：调度日的 T-1 */
export function resolveScheduledPeriod(scheduleDate: string): AutomationPeriod {
  const target = addDaysToBusinessDate(scheduleDate, -1);
  return { businessDate: scheduleDate, periodStartDate: target, periodEndDate: target };
}

function defaultRunTime(): string {
  return "08:30";
}

export async function getAutomationConfig(): Promise<AutomationConfigView> {
  const rows = await db
    .select()
    .from(automationConfig)
    .where(eq(automationConfig.tenantId, config.TENANT_ID))
    .limit(1);
  const row = rows[0];

  let environmentId = row?.environmentId ?? "";
  if (row === undefined) {
    try {
      environmentId = (await resolveEnvironment()).id;
    } catch {
      environmentId = "";
    }
  }

  const webhookUrlEnvKey = row?.webhookUrlEnvKey ?? "WECOM_WEBHOOK_URL";
  const appSecretEnvKey = row?.appSecretEnvKey ?? "WECOM_APP_SECRET";
  const appCorpId = row?.appCorpId ?? null;
  const appAgentId = row?.appAgentId ?? null;
  const toUser = row?.toUser ?? null;

  const defaultPeriod = resolveDefaultManualPeriod();

  return {
    id: row?.id ?? null,
    enabled: row?.enabled ?? false,
    runTime: row?.runTime ?? defaultRunTime(),
    channel: (row?.notifyChannel as NotifyChannel | undefined) ?? "WEBHOOK",
    environmentId,
    webhookUrlEnvKey,
    appCorpId,
    appAgentId,
    appSecretEnvKey,
    toUser,
    webhookConfigured: envConfigured(webhookUrlEnvKey),
    appSecretConfigured: envConfigured(appSecretEnvKey),
    appFieldsConfigured:
      appCorpId !== null &&
      appCorpId.trim() !== "" &&
      appAgentId !== null &&
      appAgentId.trim() !== "" &&
      toUser !== null &&
      toUser.trim() !== "",
    defaultPeriodStartDate: defaultPeriod.periodStartDate,
    defaultPeriodEndDate: defaultPeriod.periodEndDate
  };
}

export async function updateAutomationConfig(
  input: AutomationConfigInput,
  actor: string
): Promise<AutomationConfigView> {
  await getEnvironmentById(input.environmentId);

  const values = {
    enabled: input.enabled,
    runTime: input.runTime,
    notifyChannel: input.channel,
    environmentId: input.environmentId,
    webhookUrlEnvKey: input.webhookUrlEnvKey.trim(),
    appCorpId: emptyToNull(input.appCorpId),
    appAgentId: emptyToNull(input.appAgentId),
    appSecretEnvKey: input.appSecretEnvKey.trim(),
    toUser: emptyToNull(input.toUser),
    updatedBy: actor,
    updatedAt: sql`now()`
  };

  const existing = await db
    .select({ id: automationConfig.id })
    .from(automationConfig)
    .where(eq(automationConfig.tenantId, config.TENANT_ID))
    .limit(1);

  if (existing[0] === undefined) {
    await db.insert(automationConfig).values({
      id: ulid(),
      tenantId: config.TENANT_ID,
      ...values,
      createdBy: actor
    });
  } else {
    await db
      .update(automationConfig)
      .set(values)
      .where(
        and(
          eq(automationConfig.tenantId, config.TENANT_ID),
          eq(automationConfig.id, existing[0].id)
        )
      );
  }

  return getAutomationConfig();
}

export async function startAutomationRun(
  input: StartAutomationRunInput
): Promise<{ run: AutomationRunRow; created: boolean }> {
  if (activeRun !== null) {
    throw new AppError(
      "BIZ_RECONCILIATION_AUTOMATION_CONFLICT",
      "已有自动对账任务正在执行，请稍后再试"
    );
  }

  const inserted = await db
    .insert(automationRun)
    .values({
      id: ulid(),
      tenantId: config.TENANT_ID,
      runKey: input.runKey,
      triggerType: input.triggerType,
      businessDate: input.period.businessDate,
      periodStartDate: input.period.periodStartDate,
      periodEndDate: input.period.periodEndDate,
      runStatus: "PENDING",
      notifyEnabled: input.notify ?? true,
      notifyStatus: "PENDING",
      createdBy: input.actor,
      updatedBy: input.actor
    })
    .onConflictDoNothing({
      target: [automationRun.tenantId, automationRun.runKey]
    })
    .returning();

  if (inserted[0] !== undefined) {
    return { run: inserted[0], created: true };
  }

  const existing = await db
    .select()
    .from(automationRun)
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        eq(automationRun.runKey, input.runKey)
      )
    )
    .limit(1);
  if (existing[0] === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND",
      "自动对账执行记录创建失败"
    );
  }
  return { run: existing[0], created: false };
}

export async function executeAutomationRun(id: string): Promise<AutomationRunRow> {
  if (activeRun !== null) {
    throw new AppError(
      "BIZ_RECONCILIATION_AUTOMATION_CONFLICT",
      "已有自动对账任务正在执行"
    );
  }
  const promise = executeAutomationRunInternal(id);
  activeRun = promise;
  try {
    return await promise;
  } finally {
    activeRun = null;
  }
}

async function executeAutomationRunInternal(
  id: string
): Promise<AutomationRunRow> {
  const claimed = await db
    .update(automationRun)
    .set({
      runStatus: "RUNNING",
      startedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedBy: AUTOMATION_ACTOR
    })
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        eq(automationRun.id, id),
        eq(automationRun.runStatus, "PENDING")
      )
    )
    .returning();

  if (claimed[0] === undefined) {
    const existing = await db
      .select()
      .from(automationRun)
      .where(
        and(
          eq(automationRun.tenantId, config.TENANT_ID),
          eq(automationRun.id, id)
        )
      )
      .limit(1);
    if (existing[0] === undefined) {
      throw new AppError(
        "BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND",
        "自动对账执行记录不存在"
      );
    }
    return existing[0];
  }

  const run = claimed[0];
  const period: AutomationPeriod = {
    businessDate: run.businessDate,
    periodStartDate: run.periodStartDate,
    periodEndDate: run.periodEndDate
  };
  const triggerType = run.triggerType as AutomationTriggerType;

  try {
    const configView = await getAutomationConfig();
    if (configView.enabled === false && triggerType !== "MANUAL") {
      return finishRun(run.id, {
        status: "SUCCEEDED",
        summary: emptySummary(),
        messageText: null,
        notifyStatus: "SKIPPED",
        notifyChannel: null,
        notifyError: null,
        environmentId: null
      });
    }
    if (configView.environmentId === "") {
      throw new AppError(
        "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
        "未配置自动对账执行环境"
      );
    }

    const environment = await getEnvironmentById(configView.environmentId);
    const pairs = (await listPairs()).filter(
      (item) => item.pairStatus === "ACTIVE"
    );
    const pairResults: Array<{
      pair: (typeof pairs)[number];
      result?: CreateRunsForPairResult;
      error?: string;
    }> = [];
    // 同一执行内多个关系共享的数据集只直连抽取一次
    const extractionCache = new Map<string, Promise<ExtractDatasetResult>>();

    for (const pair of pairs) {
      try {
        const result = await createRunsForPair({
          pairId: pair.id,
          environmentId: environment.id,
          periodStartDate: period.periodStartDate,
          periodEndDate: period.periodEndDate,
          runMode: "FULL",
          actor: AUTOMATION_ACTOR,
          defer: false,
          extractionCache
        });
        pairResults.push({ pair, result });
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : "对账关系执行失败";
        logger.warn({
          event: "automation.pair.failed",
          automationRunId: run.id,
          pairCode: pair.pairCode,
          error: message
        });
        pairResults.push({ pair, error: message });
      }
    }

    const summary = await buildSummary(pairResults, environment.id);
    const overallStatus: AutomationRunStatus = summary.pairs.some(
      (pair) => pair.status === "FAILED" || pair.status === "PARTIAL"
    )
      ? "PARTIAL"
      : "SUCCEEDED";

    const markdown = buildAutomationMessage(summary, period, {
      format: "markdown",
      triggerType
    });
    const text = buildAutomationMessage(summary, period, {
      format: "text",
      triggerType
    });

    let notifyStatus: NotifyStatus = "SKIPPED";
    let notifyChannel: string | null = null;
    let notifyError: string | null = null;
    if (run.notifyEnabled) {
      const dispatch = await dispatchNotification(configView, { markdown, text });
      notifyStatus = dispatch.status;
      notifyChannel = dispatch.channel;
      notifyError = dispatch.error;
    }

    return finishRun(run.id, {
      status: overallStatus,
      summary,
      messageText: markdown,
      notifyStatus,
      notifyChannel,
      notifyError,
      environmentId: environment.id
    });
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : "自动对账执行失败";
    logger.error({
      event: "automation.run.failed",
      automationRunId: run.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return finishRun(run.id, {
      status: "FAILED",
      summary: null,
      messageText: null,
      notifyStatus: "SKIPPED",
      notifyChannel: null,
      notifyError: null,
      environmentId: null,
      errorMessage: message
    });
  }
}

function emptySummary(): AutomationSummary {
  return {
    pairCount: 0,
    pairExecutedCount: 0,
    pairNoDataCount: 0,
    pairFailedCount: 0,
    batchCount: 0,
    batchReusedCount: 0,
    batchSucceededCount: 0,
    batchFailedCount: 0,
    metricTotal: 0,
    failMetricCount: 0,
    diffCount: 0,
    pairs: [],
    failedMetrics: []
  };
}

async function finishRun(
  id: string,
  input: {
    status: AutomationRunStatus;
    summary: AutomationSummary | null;
    messageText: string | null;
    notifyStatus: NotifyStatus;
    notifyChannel: string | null;
    notifyError: string | null;
    environmentId: string | null;
    errorMessage?: string;
  }
): Promise<AutomationRunRow> {
  const summary = input.summary;
  const updated = await db
    .update(automationRun)
    .set({
      runStatus: input.status,
      pairCount: summary?.pairCount ?? 0,
      pairExecutedCount: summary?.pairExecutedCount ?? 0,
      pairNoDataCount: summary?.pairNoDataCount ?? 0,
      pairFailedCount: summary?.pairFailedCount ?? 0,
      batchCount: summary?.batchCount ?? 0,
      batchReusedCount: summary?.batchReusedCount ?? 0,
      batchSucceededCount: summary?.batchSucceededCount ?? 0,
      batchFailedCount: summary?.batchFailedCount ?? 0,
      metricTotal: summary?.metricTotal ?? 0,
      failMetricCount: summary?.failMetricCount ?? 0,
      diffCount: summary?.diffCount ?? 0,
      notifyStatus: input.notifyStatus,
      notifyChannel: input.notifyChannel,
      notifyError: input.notifyError === null ? null : truncate(input.notifyError, 512),
      environmentId: input.environmentId,
      summaryExt:
        summary === null
          ? null
          : (summary as unknown as Record<string, unknown>),
      messageText: input.messageText,
      errorMessage:
        input.errorMessage === undefined
          ? null
          : truncate(input.errorMessage, 512),
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedBy: AUTOMATION_ACTOR
    })
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        eq(automationRun.id, id)
      )
    )
    .returning();

  const row = updated[0];
  if (row === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND",
      "自动对账执行记录更新失败"
    );
  }
  return row;
}

interface PairResultItem {
  pair: {
    id: string;
    pairCode: string;
    pairName: string;
    pairStatus: string;
  };
  result?: CreateRunsForPairResult;
  error?: string;
}

async function buildSummary(
  pairResults: PairResultItem[],
  environmentId: string
): Promise<AutomationSummary> {
  const createdEntries = pairResults.flatMap(
    (item) => item.result?.created ?? []
  );
  const runIds = [...new Set(createdEntries.map((item) => item.runId))];

  const runRows =
    runIds.length === 0
      ? []
      : await db
          .select({
            id: checkRun.id,
            runStatus: checkRun.runStatus,
            metricTotal: checkRun.metricTotal,
            failMetricCount: checkRun.failMetricCount
          })
          .from(checkRun)
          .where(
            and(
              eq(checkRun.tenantId, config.TENANT_ID),
              inArray(checkRun.id, runIds)
            )
          );
  const runById = new Map(runRows.map((row) => [row.id, row]));

  const diffRows =
    runIds.length === 0
      ? []
      : await db
          .select({
            runId: checkDiff.runId,
            count: sql<number>`count(*)::int`
          })
          .from(checkDiff)
          .where(
            and(
              eq(checkDiff.tenantId, config.TENANT_ID),
              inArray(checkDiff.runId, runIds)
            )
          )
          .groupBy(checkDiff.runId);
  const diffByRun = new Map(diffRows.map((row) => [row.runId, row.count]));

  const failedMetricRows =
    runIds.length === 0
      ? []
      : await db
          .select({
            runId: checkMetricResult.runId,
            metricCode: checkMetricResult.metricCode,
            metricName: checkMetricResult.metricName,
            failCount: checkMetricResult.failCount
          })
          .from(checkMetricResult)
          .where(
            and(
              eq(checkMetricResult.tenantId, config.TENANT_ID),
              inArray(checkMetricResult.runId, runIds),
              eq(checkMetricResult.checkResult, "FAIL")
            )
          )
          .orderBy(desc(checkMetricResult.failCount))
          .limit(20);

  const entryByRunId = new Map(
    createdEntries.map((item) => [item.runId, item])
  );
  const failedMetrics: AutomationFailedMetric[] = failedMetricRows
    .map((row) => {
      const entry = entryByRunId.get(row.runId);
      if (entry === undefined) {
        return null;
      }
      return {
        runId: row.runId,
        packCode: entry.packCode,
        packName: entry.packName,
        metricCode: row.metricCode,
        metricName: row.metricName,
        failCount: row.failCount
      };
    })
    .filter((item): item is AutomationFailedMetric => item !== null);

  const pairs: AutomationPairSummary[] = pairResults.map((item) => {
    if (item.result === undefined) {
      return {
        pairId: item.pair.id,
        pairCode: item.pair.pairCode,
        pairName: item.pair.pairName,
        environmentId,
        status: "FAILED",
        createdCount: 0,
        reusedCount: 0,
        skippedCount: 0,
        failedCount: 1,
        metricTotal: 0,
        failMetricCount: 0,
        diffCount: 0,
        runs: [],
        skippedPacks: [],
        failedPacks: [
          { packCode: "PAIR", message: item.error ?? "对账关系执行失败" }
        ]
      };
    }

    const { result } = item;
    const runs = result.created.map((entry) => {
      const row = runById.get(entry.runId);
      return {
        runId: entry.runId,
        runNo: entry.runNo,
        packCode: entry.packCode,
        packName: entry.packName,
        runStatus: row?.runStatus ?? entry.runStatus,
        metricTotal: row?.metricTotal ?? 0,
        failMetricCount: row?.failMetricCount ?? 0,
        diffCount: diffByRun.get(entry.runId) ?? 0,
        reused: entry.reused
      };
    });

    let status: AutomationPairStatus;
    if (runs.length === 0) {
      if (result.failed.length > 0) {
        status = "FAILED";
      } else if (
        result.skipped.every(
          (skipped) =>
            skipped.reason === "DATA_NOT_READY" ||
            skipped.reason === "NO_SOURCE_DATA"
        )
      ) {
        status = "NO_DATA";
      } else {
        status = "PARTIAL";
      }
    } else if (
      result.failed.length > 0 ||
      runs.some((run) => run.runStatus !== "SUCCEEDED")
    ) {
      status = "PARTIAL";
    } else {
      status = "SUCCEEDED";
    }

    return {
      pairId: item.pair.id,
      pairCode: item.pair.pairCode,
      pairName: item.pair.pairName,
      environmentId,
      status,
      createdCount: runs.filter((run) => !run.reused).length,
      reusedCount: runs.filter((run) => run.reused).length,
      skippedCount: result.skipped.length,
      failedCount: result.failed.length,
      metricTotal: runs.reduce((sum, run) => sum + run.metricTotal, 0),
      failMetricCount: runs.reduce((sum, run) => sum + run.failMetricCount, 0),
      diffCount: runs.reduce((sum, run) => sum + run.diffCount, 0),
      runs,
      skippedPacks: result.skipped.map((skipped) => ({
        packCode: skipped.packCode,
        reason: skipped.reason
      })),
      failedPacks: result.failed.map((failed) => ({
        packCode: failed.packCode,
        message: failed.message
      }))
    };
  });

  const batchCount = runIds.length;
  const batchReusedCount = createdEntries.filter((item) => item.reused).length;
  const batchSucceededCount = runRows.filter(
    (row) => row.runStatus === "SUCCEEDED"
  ).length;
  const batchFailedCount = runRows.filter(
    (row) => row.runStatus === "FAILED" || row.runStatus === "CANCELLED"
  ).length;

  return {
    pairCount: pairs.length,
    pairExecutedCount: pairs.filter((pair) => pair.runs.length > 0).length,
    pairNoDataCount: pairs.filter((pair) => pair.status === "NO_DATA").length,
    pairFailedCount: pairs.filter((pair) => pair.status === "FAILED").length,
    batchCount,
    batchReusedCount,
    batchSucceededCount,
    batchFailedCount,
    metricTotal: pairs.reduce((sum, pair) => sum + pair.metricTotal, 0),
    failMetricCount: pairs.reduce((sum, pair) => sum + pair.failMetricCount, 0),
    diffCount: pairs.reduce((sum, pair) => sum + pair.diffCount, 0),
    pairs,
    failedMetrics
  };
}

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  SCHEDULE: "定时",
  CATCH_UP: "启动补跑",
  MANUAL: "手动"
};

export function buildAutomationMessage(
  summary: AutomationSummary,
  period: AutomationPeriod,
  options: { format: "markdown" | "text"; triggerType: AutomationTriggerType }
): string {
  const markdown = options.format === "markdown";
  const statusLabel =
    summary.pairFailedCount > 0
      ? "失败"
      : summary.pairs.some((pair) => pair.status === "PARTIAL")
        ? "部分失败"
        : "成功";
  const lines: string[] = [];
  lines.push(
    markdown
      ? `**【自动对账】${period.periodStartDate} 执行结果**`
      : `【自动对账】${period.periodStartDate} 执行结果`
  );
  lines.push(`状态：${statusLabel}`);
  lines.push(`触发：${TRIGGER_LABELS[options.triggerType]}`);
  lines.push(
    `期间：${
      period.periodStartDate === period.periodEndDate
        ? period.periodStartDate
        : `${period.periodStartDate} ~ ${period.periodEndDate}`
    }`
  );
  lines.push(
    `对账关系：${summary.pairExecutedCount} 已执行 / ${summary.pairNoDataCount} 源库期间内无数据 / ${summary.pairFailedCount} 失败`
  );
  lines.push(
    `批次：${summary.batchCount} 个（成功 ${summary.batchSucceededCount} / 失败 ${summary.batchFailedCount}），复用 ${summary.batchReusedCount}`
  );
  lines.push(
    `指标：共 ${summary.metricTotal} 项，未通过 ${summary.failMetricCount} 项；差异 ${summary.diffCount} 条`
  );
  lines.push("");

  if (summary.pairs.length === 0) {
    lines.push("本次没有启用的对账关系。");
  } else {
    for (const pair of summary.pairs.slice(0, 10)) {
      if (pair.status === "NO_DATA") {
        lines.push(`- ${pair.pairName}：源库期间内无数据`);
      } else if (pair.status === "FAILED") {
        lines.push(
          `- ${pair.pairName}：失败（${truncate(
            pair.failedPacks[0]?.message ?? "执行异常",
            80
          )}）`
        );
      } else {
        lines.push(
          `- ${pair.pairName}：${pair.runs.length} 批次 / 未通过 ${pair.failMetricCount} / 差异 ${pair.diffCount}${
            pair.status === "PARTIAL" ? "（部分失败）" : ""
          }`
        );
      }
    }
    if (summary.pairs.length > 10) {
      lines.push(`- …等 ${summary.pairs.length} 个对账关系`);
    }
  }

  if (summary.failedMetrics.length > 0) {
    lines.push("");
    lines.push("未通过指标（前 5）：");
    for (const metric of summary.failedMetrics.slice(0, 5)) {
      lines.push(
        `- ${metric.packName} / ${metric.metricName}：失败 ${metric.failCount} 条`
      );
    }
  }

  lines.push("");
  lines.push(`详情请登录对账系统查看：${config.WEB_ORIGIN}`);
  return lines.join("\n");
}

export type NotificationSendResult = WecomSendResult | RobotSendResult;

interface DispatchResult {
  status: NotifyStatus;
  channel: string | null;
  error: string | null;
  results: NotificationSendResult[];
}

async function dispatchNotification(
  configView: AutomationConfigView,
  messages: { markdown: string; text: string }
): Promise<DispatchResult> {
  const results: NotificationSendResult[] = [];

  if (configView.channel === "WEBHOOK" || configView.channel === "BOTH") {
    const webhookUrl = readSecret(configView.webhookUrlEnvKey);
    if (webhookUrl === undefined || webhookUrl.trim() === "") {
      results.push({
        channel: "WEBHOOK",
        ok: false,
        errorMessage: `环境变量 ${configView.webhookUrlEnvKey} 未配置`
      });
    } else {
      results.push(
        await sendWecomWebhook({
          webhookUrl,
          markdown: truncateUtf8ByLines(messages.markdown, WEBHOOK_MAX_BYTES)
        })
      );
    }
  }

  if (configView.channel === "APP" || configView.channel === "BOTH") {
    const secret = readSecret(configView.appSecretEnvKey);
    const corpId = configView.appCorpId ?? null;
    const agentId = configView.appAgentId ?? null;
    const toUser = configView.toUser ?? null;
    if (corpId === null || agentId === null || toUser === null) {
      results.push({
        channel: "APP",
        ok: false,
        errorMessage: "企业应用参数不完整（CorpID/AgentID/接收人）"
      });
    } else if (secret === undefined || secret.trim() === "") {
      results.push({
        channel: "APP",
        ok: false,
        errorMessage: `环境变量 ${configView.appSecretEnvKey} 未配置`
      });
    } else {
      results.push(
        await sendWecomApp({
          corpId,
          agentId,
          secret,
          toUser,
          text: truncateUtf8ByLines(messages.text, APP_MAX_BYTES)
        })
      );
    }
  }

  if (configView.channel === "ROBOT") {
    const webhookUrl = readSecret(configView.webhookUrlEnvKey);
    const targets = configView.toUser ?? null;
    if (webhookUrl === undefined || webhookUrl.trim() === "") {
      results.push({
        channel: "ROBOT",
        platform: null,
        ok: false,
        errorMessage: `环境变量 ${configView.webhookUrlEnvKey} 未配置`
      });
    } else if (targets === null || targets.trim() === "") {
      results.push({
        channel: "ROBOT",
        platform: null,
        ok: false,
        errorMessage: "飞书/钉钉机器人渠道必须填写 @ 接收人"
      });
    } else {
      results.push(
        await sendRobotWebhook({
          webhookUrl,
          text: truncateUtf8ByLines(messages.text, WEBHOOK_MAX_BYTES),
          markdown: truncateUtf8ByLines(messages.markdown, WEBHOOK_MAX_BYTES),
          targets,
          secret: readSecret(configView.appSecretEnvKey)
        })
      );
    }
  }

  const okCount = results.filter((item) => item.ok).length;
  const status: NotifyStatus =
    results.length === 0
      ? "SKIPPED"
      : okCount === results.length
        ? "SENT"
        : okCount === 0
          ? "FAILED"
          : "PARTIAL";
  const errors = results
    .filter((item) => !item.ok)
    .map((item) => item.errorMessage ?? "发送失败");

  return {
    status,
    channel: configView.channel,
    error: errors.length === 0 ? null : errors.join("；"),
    results
  };
}

export async function testAutomationNotification(): Promise<{
  ok: boolean;
  channel: string;
  results: NotificationSendResult[];
  message: string;
}> {
  const configView = await getAutomationConfig();
  const today = businessToday(config.BUSINESS_TIME_ZONE);
  const markdown = `**【自动对账】通知测试**\n通知配置有效。\n发送日期：${today}`;
  const text = `【自动对账】通知测试\n通知配置有效。\n发送日期：${today}`;
  const dispatch = await dispatchNotification(configView, { markdown, text });
  return {
    ok: dispatch.status === "SENT",
    channel: dispatch.channel ?? configView.channel,
    results: dispatch.results,
    message:
      dispatch.error ??
      (dispatch.status === "SENT" ? "测试消息已发送" : "未发送测试消息")
  };
}

export async function startManualRun(
  input: {
    periodStartDate?: string;
    periodEndDate?: string;
    notify?: boolean;
  },
  actor: string
): Promise<{ automationRunId: string; runKey: string }> {
  const start = input.periodStartDate;
  const end = input.periodEndDate;
  if ((start === undefined) !== (end === undefined)) {
    throw new AppError(
      "BIZ_RECONCILIATION_AUTOMATION_INVALID_INPUT",
      "手动执行需同时提供期间起日和止日"
    );
  }

  let period: AutomationPeriod;
  if (start !== undefined && end !== undefined) {
    if (start > end) {
      throw new AppError(
        "BIZ_RECONCILIATION_AUTOMATION_INVALID_INPUT",
        "期间起日不能晚于止日"
      );
    }
    period = {
      businessDate: end,
      periodStartDate: start,
      periodEndDate: end
    };
  } else {
    period = resolveDefaultManualPeriod();
  }

  const runKey = `manual:${period.periodStartDate}:${period.periodEndDate}:${ulid()}`;
  const { run } = await startAutomationRun({
    triggerType: "MANUAL",
    period,
    runKey,
    actor,
    notify: input.notify
  });

  void executeAutomationRun(run.id).catch((error: unknown) => {
    logger.error({
      event: "automation.manual.failed",
      automationRunId: run.id,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return { automationRunId: run.id, runKey };
}

export async function listAutomationRuns(limit = 20) {
  return db
    .select({
      id: automationRun.id,
      runKey: automationRun.runKey,
      triggerType: automationRun.triggerType,
      businessDate: automationRun.businessDate,
      periodStartDate: automationRun.periodStartDate,
      periodEndDate: automationRun.periodEndDate,
      environmentId: automationRun.environmentId,
      runStatus: automationRun.runStatus,
      pairCount: automationRun.pairCount,
      pairExecutedCount: automationRun.pairExecutedCount,
      pairNoDataCount: automationRun.pairNoDataCount,
      pairFailedCount: automationRun.pairFailedCount,
      batchCount: automationRun.batchCount,
      batchReusedCount: automationRun.batchReusedCount,
      batchSucceededCount: automationRun.batchSucceededCount,
      batchFailedCount: automationRun.batchFailedCount,
      metricTotal: automationRun.metricTotal,
      failMetricCount: automationRun.failMetricCount,
      diffCount: automationRun.diffCount,
      notifyEnabled: automationRun.notifyEnabled,
      notifyStatus: automationRun.notifyStatus,
      notifyChannel: automationRun.notifyChannel,
      notifyError: automationRun.notifyError,
      errorMessage: automationRun.errorMessage,
      startedAt: automationRun.startedAt,
      finishedAt: automationRun.finishedAt,
      createdAt: automationRun.createdAt
    })
    .from(automationRun)
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        isNull(automationRun.deletedAt)
      )
    )
    .orderBy(desc(automationRun.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getAutomationRunById(id: string): Promise<AutomationRunRow> {
  const rows = await db
    .select()
    .from(automationRun)
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        eq(automationRun.id, id),
        isNull(automationRun.deletedAt)
      )
    )
    .limit(1);
  if (rows[0] === undefined) {
    throw new AppError(
      "BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND",
      "自动对账执行记录不存在"
    );
  }
  return rows[0];
}

/**
 * 删除自动对账执行记录（软删除）。
 * 只删除记录本身，保留对账批次/指标结果/差异，避免影响报表、差异处置与其他复用该批次的执行。
 */
export async function deleteAutomationRun(
  id: string,
  actor: string
): Promise<{ id: string }> {
  const run = await getAutomationRunById(id);
  if (run.runStatus === "PENDING" || run.runStatus === "RUNNING") {
    throw new AppError(
      "BIZ_RECONCILIATION_AUTOMATION_CONFLICT",
      "执行中的记录不能删除，请等待执行结束"
    );
  }
  await db
    .update(automationRun)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedBy: actor
    })
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        eq(automationRun.id, id),
        isNull(automationRun.deletedAt)
      )
    );
  logger.info({ event: "automation.run.deleted", automationRunId: id, actor });
  return { id };
}

/** 进程重启后回收残留的执行中记录，避免永远停留在 RUNNING。 */
export async function recoverStaleAutomationRuns(): Promise<number> {
  await db
    .update(automationRun)
    .set({
      notifyStatus: "SKIPPED",
      updatedAt: sql`now()`,
      updatedBy: "agent:startup"
    })
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        eq(automationRun.notifyStatus, "PENDING"),
        inArray(automationRun.runStatus, ["PENDING", "RUNNING"])
      )
    );

  const rows = await db
    .update(automationRun)
    .set({
      runStatus: "FAILED",
      errorMessage: "服务重启，自动对账中断",
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedBy: "agent:startup"
    })
    .where(
      and(
        eq(automationRun.tenantId, config.TENANT_ID),
        inArray(automationRun.runStatus, ["PENDING", "RUNNING"])
      )
    )
    .returning({ id: automationRun.id });

  if (rows.length > 0) {
    logger.warn({ event: "automation.recovered_stale", count: rows.length });
  }
  return rows.length;
}
