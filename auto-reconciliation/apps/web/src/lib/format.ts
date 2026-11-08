// UI 展示层允许做时间格式化与时区呈现；业务计算仍只在 engine 的 Time/Money 封装内。
export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

/** 金额仅做字符串展示，不参与计算，避免 Number 精度损失 */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const negative = value.startsWith("-");
  const absolute = negative ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = absolute.split(".");
  const withSeparators = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(4, "0").slice(0, 4);
  return `${negative ? "-" : ""}${withSeparators}.${fraction}`;
}

/** 金额绝对值，仅做字符串处理，不经过 Number */
export function absMoneyString(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "0.0000";
  }
  return value.startsWith("-") ? value.slice(1) : value;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function shortId(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function checkTone(result: string | null | undefined): "success" | "danger" | "neutral" {
  if (result === "PASS" || result === "SUCCEEDED" || result === "PASSED" || result === "SIGNED_OFF") {
    return "success";
  }
  if (result === "FAIL" || result === "FAILED" || result === "BLOCKED") {
    return "danger";
  }
  return "neutral";
}
