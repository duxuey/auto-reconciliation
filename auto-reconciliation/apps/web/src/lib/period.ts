import { businessToday } from "@infra/biz-reconciliation-engine";

export interface DatePeriod {
  periodStartDate: string;
  periodEndDate: string;
}

function lastDayOfMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 当前自然月，作为没有历史执行时的默认期间。 */
export function currentMonthPeriod(): DatePeriod {
  const today = businessToday();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prefix = `${today.slice(0, 7)}-`;
  return {
    periodStartDate: `${prefix}01`,
    periodEndDate: `${prefix}${`${lastDayOfMonth(year, month)}`.padStart(2, "0")}`
  };
}

/** 从 URL 查询参数读取期间；缺省返回 undefined。 */
export function periodFromSearch(search: string): DatePeriod | undefined {
  const params = new URLSearchParams(search);
  const periodStartDate = params.get("periodStartDate");
  const periodEndDate = params.get("periodEndDate");
  if (periodStartDate === null || periodEndDate === null) {
    return undefined;
  }
  return { periodStartDate, periodEndDate };
}

/** 生成下钻链接使用的期间查询串（不含问号）。 */
export function periodQuery(period: DatePeriod): string {
  return `periodStartDate=${encodeURIComponent(
    period.periodStartDate
  )}&periodEndDate=${encodeURIComponent(period.periodEndDate)}`;
}
