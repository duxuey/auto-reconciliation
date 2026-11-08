import { addDays, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// 时间全链路唯一入口；裸 Date 只允许出现在本文件。
export const DEFAULT_BUSINESS_ZONE = "Asia/Shanghai";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** 解析为 UTC ISO 字符串 */
export function parseInstant(value: string, zone: string = DEFAULT_BUSINESS_ZONE): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error("时间为空");
  }
  if (ZONED_ISO.test(trimmed)) {
    return parseISO(trimmed).toISOString();
  }
  if (LOCAL_DATETIME.test(trimmed)) {
    return fromZonedTime(trimmed.replace(" ", "T"), zone).toISOString();
  }
  if (DATE_ONLY.test(trimmed)) {
    return fromZonedTime(`${trimmed}T00:00:00`, zone).toISOString();
  }
  throw new Error(`无法识别的时间格式: ${value}`);
}

/** 解析为业务日期 YYYY-MM-DD */
export function parseBusinessDate(value: string, zone: string = DEFAULT_BUSINESS_ZONE): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    return trimmed;
  }
  return formatInTimeZone(parseISO(parseInstant(trimmed, zone)), zone, "yyyy-MM-dd");
}

/** 当前 UTC 时间；业务代码不得直接使用裸 Date */
export function nowInstant(): string {
  return new Date().toISOString();
}

/** 当前毫秒时间戳 */
export function nowEpochMs(): number {
  return new Date().getTime();
}

/** 当前业务日期 */
export function businessToday(zone: string = DEFAULT_BUSINESS_ZONE): string {
  return formatInTimeZone(new Date(), zone, "yyyy-MM-dd");
}

/** 按业务时区格式化 */
export function formatInstant(
  instant: string,
  pattern: string,
  zone: string = DEFAULT_BUSINESS_ZONE
): string {
  return formatInTimeZone(parseISO(instant), zone, pattern);
}

export function isWithinPeriod(
  businessDate: string,
  periodStartDate: string,
  periodEndDate: string
): boolean {
  return businessDate >= periodStartDate && businessDate <= periodEndDate;
}

/** 业务日期转期间代码 YYYYMM */
export function periodCodeFromDate(businessDate: string): string {
  return businessDate.slice(0, 7).replace("-", "");
}

/** 距今天数，用于差异账龄；Date 只在封装内出现 */
export function daysSince(instant: string, now: string = nowInstant()): number {
  const diff = parseISO(now).getTime() - parseISO(instant).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

/** 纯日期加减，返回 YYYY-MM-DD；用于 T-1、下次执行日期等 */
export function addDaysToBusinessDate(date: string, days: number): string {
  const parsed = parseISO(`${date}T00:00:00Z`);
  return addDays(parsed, days).toISOString().slice(0, 10);
}

/** 把任意时刻格式化为指定业务时区的 YYYY-MM-DD */
export function businessDateOfInstant(
  instant: string,
  zone: string = DEFAULT_BUSINESS_ZONE
): string {
  return formatInTimeZone(parseISO(instant), zone, "yyyy-MM-dd");
}

/** 业务日期 + HH:mm 转 UTC ISO 时刻 */
export function businessDateTimeInstant(
  date: string,
  time: string,
  zone: string = DEFAULT_BUSINESS_ZONE
): string {
  return fromZonedTime(`${date}T${time}:00`, zone).toISOString();
}

/** 距指定时刻的毫秒数；已过期返回负数 */
export function millisecondsUntil(
  instant: string,
  now: string = nowInstant()
): number {
  return parseISO(instant).getTime() - parseISO(now).getTime();
}
