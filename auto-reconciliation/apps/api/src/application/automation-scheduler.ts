import { millisecondsUntil, nowInstant } from "@infra/biz-reconciliation-engine";
import { config } from "../config.js";
import { logger } from "../infra/logger.js";
import {
  computeLatestDueScheduleDate,
  computeNextRunAt
} from "./automation-schedule.js";
import {
  executeAutomationRun,
  getAutomationConfig,
  isAutomationRunning,
  recoverStaleAutomationRuns,
  resolveScheduledPeriod,
  startAutomationRun
} from "./automation.js";

export interface AutomationScheduleInfo {
  started: boolean;
  nextRunAt: string | null;
  inFlight: boolean;
}

const MAX_TIMEOUT_MS = 2_147_483_647;
const RETRY_DELAY_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let nextRunAt: string | null = null;
let started = false;
let inFlight: Promise<void> | null = null;

function logError(event: string, error: unknown): void {
  logger.warn({
    event,
    error: error instanceof Error ? error.message : String(error)
  });
}

async function runDue(
  scheduleDate: string,
  triggerType: "SCHEDULE" | "CATCH_UP"
): Promise<void> {
  const runKey = `daily:${scheduleDate}`;
  const period = resolveScheduledPeriod(scheduleDate);
  try {
    const { run, created } = await startAutomationRun({
      triggerType,
      period,
      runKey,
      actor: "agent:automation"
    });
    if (!created) {
      logger.info({
        event: "automation.schedule.skipped_existing",
        automationRunId: run.id,
        scheduleDate
      });
      return;
    }
    inFlight = executeAutomationRun(run.id)
      .then(() => undefined)
      .catch((error: unknown) => {
        logError("automation.schedule.failed", error);
      })
      .finally(() => {
        inFlight = null;
      });
    await inFlight;
  } catch (error) {
    logError("automation.schedule.start_failed", error);
  }
}

async function catchUpIfDue(): Promise<void> {
  const configView = await getAutomationConfig();
  if (!configView.enabled) {
    return;
  }
  const scheduleDate = computeLatestDueScheduleDate(
    configView.runTime,
    config.BUSINESS_TIME_ZONE,
    nowInstant()
  );
  await runDue(scheduleDate, "CATCH_UP");
}

async function scheduleNext(): Promise<void> {
  generation += 1;
  const current = generation;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  nextRunAt = null;

  let configView;
  try {
    configView = await getAutomationConfig();
  } catch (error) {
    logError("automation.schedule.config_failed", error);
    if (current === generation) {
      timer = setTimeout(() => {
        void scheduleNext();
      }, RETRY_DELAY_MS);
    }
    return;
  }

  if (current !== generation) {
    return;
  }
  if (!configView.enabled) {
    logger.info({ event: "automation.schedule.disabled" });
    return;
  }

  const now = nowInstant();
  const next = computeNextRunAt(
    configView.runTime,
    config.BUSINESS_TIME_ZONE,
    now
  );
  nextRunAt = next;
  const delay = Math.min(
    Math.max(0, millisecondsUntil(next, now)),
    MAX_TIMEOUT_MS
  );
  timer = setTimeout(() => {
    if (current !== generation) {
      return;
    }
    void tick();
  }, delay);
  logger.info({ event: "automation.schedule.armed", nextRunAt: next });
}

async function tick(): Promise<void> {
  try {
    const configView = await getAutomationConfig();
    if (configView.enabled) {
      const scheduleDate = computeLatestDueScheduleDate(
        configView.runTime,
        config.BUSINESS_TIME_ZONE,
        nowInstant()
      );
      await runDue(scheduleDate, "SCHEDULE");
    }
  } catch (error) {
    logError("automation.schedule.tick_failed", error);
  } finally {
    await scheduleNext();
  }
}

export async function startAutomationScheduler(): Promise<void> {
  if (started) {
    return;
  }
  started = true;
  await recoverStaleAutomationRuns();
  await catchUpIfDue();
  await scheduleNext();
}

/** 配置更新后立即重排定时器；不触发补跑。 */
export function refreshAutomationSchedule(): void {
  if (!started) {
    return;
  }
  void scheduleNext().catch((error: unknown) => {
    logError("automation.schedule.refresh_failed", error);
  });
}

export async function stopAutomationScheduler(): Promise<void> {
  started = false;
  generation += 1;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  nextRunAt = null;
  if (inFlight !== null) {
    await inFlight.catch(() => undefined);
  }
}

export function getAutomationScheduleInfo(): AutomationScheduleInfo {
  return {
    started,
    nextRunAt,
    inFlight: inFlight !== null || isAutomationRunning()
  };
}
