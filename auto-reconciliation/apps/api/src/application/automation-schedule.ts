import {
  addDaysToBusinessDate,
  businessDateOfInstant,
  businessDateTimeInstant
} from "@infra/biz-reconciliation-engine";

/** 下一次执行时刻（UTC ISO）；按自然日，不跳过周末。 */
export function computeNextRunAt(
  runTime: string,
  zone: string,
  now: string
): string {
  const today = businessDateOfInstant(now, zone);
  let date = today;
  let candidate = businessDateTimeInstant(date, runTime, zone);
  if (candidate <= now) {
    date = addDaysToBusinessDate(today, 1);
    candidate = businessDateTimeInstant(date, runTime, zone);
  }
  return candidate;
}

/** 最近一个「执行时间已到」的调度日；用于启动补跑。 */
export function computeLatestDueScheduleDate(
  runTime: string,
  zone: string,
  now: string
): string {
  const today = businessDateOfInstant(now, zone);
  const todayRun = businessDateTimeInstant(today, runTime, zone);
  return todayRun <= now ? today : addDaysToBusinessDate(today, -1);
}
