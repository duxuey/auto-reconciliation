import { businessToday } from "@infra/biz-reconciliation-engine";

export interface YearMonth {
  year: number;
  month: number;
}

/** 从 YYYY-MM-DD 解析年月；空值或非法格式回退到业务今天 */
export function parseYearMonth(value: string): YearMonth {
  const today = businessToday();
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
  return {
    year: Number(text.slice(0, 4)),
    month: Number(text.slice(5, 7))
  };
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 0 = 周日，1 = 周一，……，6 = 周六 */
export function weekdayOf(year: number, month: number, day: number): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;
  return (
    (adjustedYear +
      Math.floor(adjustedYear / 4) -
      Math.floor(adjustedYear / 100) +
      Math.floor(adjustedYear / 400) +
      offsets[month - 1]! +
      day) %
    7
  );
}

export function shiftMonth(view: YearMonth, delta: number): YearMonth {
  const index = view.year * 12 + (view.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function toDateString(year: number, month: number, day: number): string {
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
}
