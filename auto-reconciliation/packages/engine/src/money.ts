import { Decimal } from "decimal.js";
import { moneyStringSchema } from "@shared/schemas";

// 金额全链路唯一运算入口；decimal.js 只在本文件出现。
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const MONEY_SCALE = 4;
export const RATE_SCALE = 6;

export interface Tolerance {
  /** 绝对容差，decimal 字符串 */
  abs: string;
  /** 相对容差，按两侧绝对值较大者计算 */
  rel?: string;
}

function toDecimal(value: string): Decimal {
  const parsed = moneyStringSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`非法十进制数值: ${value}`);
  }
  return new Decimal(value);
}

function scaleTo(value: string, scale: number): string {
  const decimal = toDecimal(value);
  if (decimal.decimalPlaces() > scale) {
    throw new Error(`数值 ${value} 的小数位超过 ${scale} 位`);
  }
  return decimal.toFixed(scale);
}

/** 金额归一化为 4 位小数字符串 */
export function normalizeMoney(value: string): string {
  return scaleTo(value, MONEY_SCALE);
}

/** 费率归一化为 6 位小数字符串 */
export function normalizeRate(value: string): string {
  return scaleTo(value, RATE_SCALE);
}

/** 归一化动态金额集合，任一项非法即抛错（由导入层转成行错误） */
export function normalizeAmounts(amounts: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [field, value] of Object.entries(amounts)) {
    normalized[field] = normalizeMoney(value);
  }
  return normalized;
}

export function zeroMoney(): string {
  return "0.0000";
}

export function addMoney(left: string, right: string): string {
  return toDecimal(left).plus(toDecimal(right)).toFixed(MONEY_SCALE);
}

export function subtractMoney(left: string, right: string): string {
  return toDecimal(left).minus(toDecimal(right)).toFixed(MONEY_SCALE);
}

export function negateMoney(value: string): string {
  return toDecimal(value).negated().toFixed(MONEY_SCALE);
}

export function absMoney(value: string): string {
  return toDecimal(value).abs().toFixed(MONEY_SCALE);
}

export function sumMoney(values: readonly string[]): string {
  return values.reduce((total, value) => addMoney(total, value), zeroMoney());
}

/** right - left */
export function diffMoney(left: string, right: string): string {
  return subtractMoney(right, left);
}

export function compareMoney(left: string, right: string): number {
  return toDecimal(left).comparedTo(toDecimal(right));
}

export function isZeroMoney(value: string): boolean {
  return toDecimal(value).isZero();
}

export function maxMoney(left: string, right: string): string {
  return compareMoney(left, right) >= 0 ? normalizeMoney(left) : normalizeMoney(right);
}

/** 超过容差返回 true；limit = max(abs, rel × max(|left|,|right|)) */
export function exceedsTolerance(
  left: string,
  right: string,
  tolerance: Tolerance
): boolean {
  const leftDecimal = toDecimal(left);
  const rightDecimal = toDecimal(right);
  const difference = rightDecimal.minus(leftDecimal).abs();
  const absolute = toDecimal(tolerance.abs);
  const relative = tolerance.rel === undefined ? new Decimal(0) : toDecimal(tolerance.rel);
  const largest = Decimal.max(leftDecimal.abs(), rightDecimal.abs());
  const limit = Decimal.max(absolute, relative.times(largest));
  return difference.greaterThan(limit);
}

/** 计数等非金额数值转成可落 numeric 的字符串 */
export function countToMoneyString(value: number): string {
  return new Decimal(value).toFixed(MONEY_SCALE);
}

/** 任意数值字符串取最大值（汇率口径与 SQL 的 MAX 对齐） */
export function maxNumericString(left: string, right: string): string {
  const leftDecimal = toDecimal(left);
  const rightDecimal = toDecimal(right);
  return rightDecimal.greaterThan(leftDecimal)
    ? normalizeMoney(right)
    : normalizeMoney(left);
}
