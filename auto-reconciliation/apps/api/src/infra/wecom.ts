import { nowEpochMs } from "@infra/biz-reconciliation-engine";
import { sha256 } from "@shared/utils";

const DEFAULT_TIMEOUT_MS = 10_000;
const WEBHOOK_MAX_BYTES = 4096;
const APP_TEXT_MAX_BYTES = 2048;
const TOKEN_EARLY_EXPIRE_SECONDS = 300;

export type WecomChannel = "WEBHOOK" | "APP";

export interface WecomSendResult {
  channel: WecomChannel;
  ok: boolean;
  errcode?: number;
  errorMessage?: string;
}

export interface WecomWebhookOptions {
  webhookUrl: string;
  markdown: string;
  timeoutMs?: number;
}

export interface WecomAppOptions {
  corpId: string;
  agentId: string;
  secret: string;
  toUser: string;
  text: string;
  timeoutMs?: number;
}

interface WecomApiResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

interface TokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const tokenInflight = new Map<string, Promise<string>>();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

async function readJson(response: Response): Promise<WecomApiResponse | null> {
  try {
    const value: unknown = await response.json();
    if (value !== null && typeof value === "object") {
      return value as WecomApiResponse;
    }
    return null;
  } catch {
    return null;
  }
}

function failure(
  channel: WecomChannel,
  errorMessage: string,
  errcode?: number
): WecomSendResult {
  return { channel, ok: false, errcode, errorMessage };
}

/**
 * 企业微信群机器人：POST webhook，markdown 消息。
 * 任何错误信息都不包含 webhook URL / key。
 */
export async function sendWecomWebhook(
  options: WecomWebhookOptions
): Promise<WecomSendResult> {
  const content = truncateUtf8ByLines(options.markdown, WEBHOOK_MAX_BYTES);
  try {
    const response = await fetch(options.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });
    const data = await readJson(response);
    const errcode = data?.errcode;
    if (!response.ok) {
      return failure("WEBHOOK", `群机器人请求失败（HTTP ${response.status}）`, errcode);
    }
    if (errcode !== undefined && errcode !== 0) {
      return failure(
        "WEBHOOK",
        `群机器人返回错误（errcode=${errcode}）：${data?.errmsg ?? "未知错误"}`,
        errcode
      );
    }
    return { channel: "WEBHOOK", ok: true, errcode: 0 };
  } catch (error) {
    return failure("WEBHOOK", `群机器人请求失败：${messageOf(error)}`);
  }
}

async function fetchAccessToken(
  corpId: string,
  secret: string,
  timeoutMs: number
): Promise<string> {
  const url =
    "https://qyapi.weixin.qq.com/cgi-bin/gettoken" +
    `?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await readJson(response);
  if (!response.ok || data === null) {
    throw new Error(`获取 access_token 失败（HTTP ${response.status}）`);
  }
  if (data.errcode !== undefined && data.errcode !== 0) {
    throw new Error(
      `获取 access_token 失败（errcode=${data.errcode}）：${data.errmsg ?? "未知错误"}`
    );
  }
  if (data.access_token === undefined || data.access_token === "") {
    throw new Error("获取 access_token 失败：响应缺少 access_token");
  }
  return data.access_token;
}

async function getAccessToken(
  corpId: string,
  secret: string,
  timeoutMs: number,
  forceRefresh = false
): Promise<string> {
  const key = `${corpId}:${sha256(secret)}`;
  if (!forceRefresh) {
    const cached = tokenCache.get(key);
    if (cached !== undefined && cached.expiresAtMs > nowEpochMs()) {
      return cached.token;
    }
    const pending = tokenInflight.get(key);
    if (pending !== undefined) {
      return pending;
    }
  }

  const promise = fetchAccessToken(corpId, secret, timeoutMs)
    .then((token) => {
      const expiresIn = 7200;
      tokenCache.set(key, {
        token,
        expiresAtMs:
          nowEpochMs() + Math.max(60, expiresIn - TOKEN_EARLY_EXPIRE_SECONDS) * 1000
      });
      return token;
    })
    .finally(() => {
      tokenInflight.delete(key);
    });
  tokenInflight.set(key, promise);
  return promise;
}

async function sendAppMessage(
  token: string,
  agentId: number,
  toUser: string,
  content: string,
  timeoutMs: number
): Promise<{ response: Response; data: WecomApiResponse | null }> {
  const url =
    "https://qyapi.weixin.qq.com/cgi-bin/message/send" +
    `?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "text",
      agentid: agentId,
      text: { content },
      safe: 0
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { response, data: await readJson(response) };
}

/**
 * 企业微信自建应用消息：gettoken（带缓存）→ message/send，text 消息。
 */
export async function sendWecomApp(
  options: WecomAppOptions
): Promise<WecomSendResult> {
  const content = truncateUtf8ByLines(options.text, APP_TEXT_MAX_BYTES);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const agentId = Number(options.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return failure("APP", "AgentID 必须为正整数");
  }
  if (options.corpId.trim() === "" || options.secret.trim() === "") {
    return failure("APP", "企业应用参数不完整");
  }
  if (options.toUser.trim() === "") {
    return failure("APP", "接收人不能为空");
  }

  try {
    let token = await getAccessToken(options.corpId, options.secret, timeoutMs);
    let result = await sendAppMessage(token, agentId, options.toUser, content, timeoutMs);

    if (result.data?.errcode === 42001 || result.data?.errcode === 40014) {
      token = await getAccessToken(options.corpId, options.secret, timeoutMs, true);
      result = await sendAppMessage(token, agentId, options.toUser, content, timeoutMs);
    }

    if (!result.response.ok) {
      return failure(
        "APP",
        `应用消息请求失败（HTTP ${result.response.status}）`,
        result.data?.errcode
      );
    }
    const errcode = result.data?.errcode;
    if (errcode !== undefined && errcode !== 0) {
      return failure(
        "APP",
        `应用消息返回错误（errcode=${errcode}）：${result.data?.errmsg ?? "未知错误"}`,
        errcode
      );
    }
    return { channel: "APP", ok: true, errcode: 0 };
  } catch (error) {
    return failure("APP", `应用消息发送失败：${messageOf(error)}`);
  }
}

/**
 * 按整行截断 UTF-8 文本，避免把多字节字符切坏。
 * maxBytes 按字节计；截断后追加提示行。
 */
export function truncateUtf8ByLines(
  text: string,
  maxBytes: number,
  suffix = "\n…（内容过长已截断）"
): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const budget = Math.max(0, maxBytes - suffixBytes);
  const lines = text.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
    if (used + lineBytes > budget) {
      break;
    }
    kept.push(line);
    used += lineBytes;
  }
  if (kept.length > 0) {
    return `${kept.join("\n")}${suffix}`;
  }

  let prefix = "";
  for (const char of text) {
    if (Buffer.byteLength(prefix + char, "utf8") > budget) {
      break;
    }
    prefix += char;
  }
  return `${prefix}${suffix}`;
}

/** 测试辅助：清空 token 缓存 */
export function resetWecomTokenCacheForTest(): void {
  tokenCache.clear();
  tokenInflight.clear();
}
