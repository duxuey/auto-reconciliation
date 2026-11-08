import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// 环境差异只在此处解析；业务代码不得直接读 process.env。
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL 必填"),
  TENANT_ID: z.string().length(26, "TENANT_ID 必须是 26 位占位 ID"),
  DEFAULT_ACTOR: z
    .string()
    .regex(/^(user|agent):[A-Za-z0-9._:-]+$/, "DEFAULT_ACTOR 格式必须为 user:<id> 或 agent:<id>"),
  BUSINESS_TIME_ZONE: z.string().default("Asia/Shanghai"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // 0 = 暂不限制；后续通过配置管控
  MAX_RUN_ROWS: z.coerce.number().int().nonnegative().default(0),
  // 未显式选择环境时使用的环境编码（对应 biz_reconciliation_environment.env_code）
  DEFAULT_ENVIRONMENT_CODE: z.string().min(1).default("TEST"),
  RI_SERVICE_BASE_URL: z.string().url().optional(),
  LEGACY_MYSQL_HOST: z.string().optional(),
  LEGACY_MYSQL_PORT: z.coerce.number().int().optional(),
  LEGACY_MYSQL_USER: z.string().optional(),
  LEGACY_MYSQL_PASSWORD: z.string().optional(),
  LEGACY_MYSQL_DATABASE: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`环境配置非法: ${details}`);
}

export const config = parsed.data;

/**
 * 密钥只按环境变量名读取，不进入数据库、不打印。
 * 环境表中的 db_password_env_key 指向这里，避免明文落库。
 */
export function readSecret(envKey: string): string | undefined {
  return process.env[envKey];
}

/**
 * 密码环境变量名只允许 POSIX 变量名格式。
 * 用于拒绝把密码本身填进「密码环境变量名」字段（如 123456）。
 */
export const PASSWORD_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isPasswordEnvKey(value: string): boolean {
  return PASSWORD_ENV_KEY_PATTERN.test(value);
}

export const isLegacyMysqlConfigured = (): boolean =>
  config.LEGACY_MYSQL_HOST !== undefined &&
  config.LEGACY_MYSQL_USER !== undefined &&
  config.LEGACY_MYSQL_DATABASE !== undefined;
