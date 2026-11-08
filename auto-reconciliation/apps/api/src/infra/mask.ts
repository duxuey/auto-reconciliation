const PII_KEYS = new Set([
  "partyName",
  "party_name",
  "payeeName",
  "payee_name",
  "insuredName",
  "insured_name",
  "accountNo",
  "account_no",
  "bankAccount",
  "bank_account"
]);

/** 姓名类：保留首字符 */
export function maskName(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return `${value.slice(0, 1)}***`;
}

/** 账号类：保留后四位 */
export function maskAccount(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value.length <= 4) {
    return "****";
  }
  return `****${value.slice(-4)}`;
}

function maskValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return key.toLowerCase().includes("account") ? maskAccount(value) : maskName(value);
  }
  return "***";
}

/** 日志/链路输出前统一脱敏；只处理已知 PII 键，避免误伤业务字段 */
export function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = PII_KEYS.has(key) ? maskValue(key, entry) : sanitizeForLog(entry);
    }
    return output;
  }
  return value;
}
