import { createHmac } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 10_000;

export type RobotPlatform = "FEISHU" | "DINGTALK";

export interface RobotSendResult {
  channel: "ROBOT";
  platform: RobotPlatform | null;
  ok: boolean;
  errorMessage?: string;
}

export interface RobotWebhookOptions {
  webhookUrl: string;
  /** 纯文本消息（飞书使用） */
  text: string;
  /** Markdown 消息（钉钉使用） */
  markdown: string;
  /** @ 接收人，多个用 | 分隔；all 表示 @所有人 */
  targets?: string | null;
  /** 钉钉机器人「加签」密钥；未配置时按关键词/IP 白名单方式发送 */
  secret?: string | null;
  timeoutMs?: number;
}

interface RobotApiResponse {
  code?: number;
  StatusCode?: number;
  msg?: string;
  errcode?: number;
  errmsg?: string;
}

async function readJson(response: Response): Promise<RobotApiResponse | null> {
  try {
    const value: unknown = await response.json();
    if (value !== null && typeof value === "object") {
      return value as RobotApiResponse;
    }
    return null;
  } catch {
    return null;
  }
}

function failure(
  platform: RobotPlatform | null,
  errorMessage: string
): RobotSendResult {
  return { channel: "ROBOT", platform, ok: false, errorMessage };
}

/** 根据 Webhook 地址识别平台；识别不出时返回 null。 */
export function detectRobotPlatform(webhookUrl: string): RobotPlatform | null {
  try {
    const parsed = new URL(webhookUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "open.feishu.cn" ||
      host === "open.larksuite.com" ||
      host.endsWith(".feishu.cn") ||
      host.endsWith(".larksuite.com") ||
      parsed.pathname.includes("/open-apis/bot")
    ) {
      return "FEISHU";
    }
    if (
      host === "oapi.dingtalk.com" ||
      host.endsWith(".dingtalk.com") ||
      parsed.pathname.includes("/robot/send")
    ) {
      return "DINGTALK";
    }
    return null;
  } catch {
    return null;
  }
}

/** 解析 @ 接收人：支持 |、逗号、分号、空白分隔，并去掉前导 @。 */
export function parseRobotTargets(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) {
    return [];
  }
  return raw
    .split(/[|,，;；\s]+/)
    .map((item) => item.trim().replace(/^@+/, ""))
    .filter((item) => item !== "");
}

function isAtAll(target: string): boolean {
  return target === "all" || target === "@all";
}

/** 飞书文本消息：@ 成员使用 <at user_id="open_id"></at>。 */
export function buildFeishuPayload(text: string, targets: string[]): unknown {
  const mentions = targets
    .map((target) => {
      const userId = isAtAll(target) ? "all" : target.replace(/["<>]/g, "");
      return `<at user_id="${userId}"></at>`;
    })
    .join(" ");
  return {
    msg_type: "text",
    content: { text: mentions === "" ? text : `${text}\n\n${mentions}` }
  };
}

/** 钉钉 Markdown 消息：手机号进 atMobiles，其余账号进 atUserIds。 */
export function buildDingTalkPayload(
  title: string,
  markdown: string,
  targets: string[]
): unknown {
  const atAll = targets.some(isAtAll);
  const mobiles = targets.filter((target) => /^1\d{10}$/.test(target));
  const userIds = targets.filter(
    (target) => !isAtAll(target) && !/^1\d{10}$/.test(target)
  );
  const mentions = targets
    .filter((target) => !isAtAll(target))
    .map((target) => `@${target}`)
    .join(" ");
  return {
    msgtype: "markdown",
    markdown: {
      title,
      text: mentions === "" ? markdown : `${markdown}\n\n${mentions}`
    },
    at: {
      atMobiles: mobiles,
      atUserIds: userIds,
      isAtAll: atAll
    }
  };
}

/**
 * 钉钉机器人「加签」：在 Webhook 地址上追加 timestamp 与 sign。
 * 签名密钥只参与 HMAC 计算，不写入日志或返回值。
 */
export function signDingTalkUrl(
  webhookUrl: string,
  secret: string,
  timestamp: number
): string {
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");
  const url = new URL(webhookUrl);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url.toString();
}

/**
 * 发送到飞书/钉钉群机器人。任何错误信息都不包含 Webhook 地址或 token。
 */
export async function sendRobotWebhook(
  options: RobotWebhookOptions
): Promise<RobotSendResult> {
  const platform = detectRobotPlatform(options.webhookUrl);
  if (platform === null) {
    return failure(null, "仅支持飞书或钉钉机器人 Webhook 地址");
  }
  const targets = parseRobotTargets(options.targets);
  const body =
    platform === "FEISHU"
      ? buildFeishuPayload(options.text, targets)
      : buildDingTalkPayload("自动对账结果", options.markdown, targets);
  const signSecret = options.secret?.trim() ?? "";
  const requestUrl =
    platform === "DINGTALK" && signSecret !== ""
      ? signDingTalkUrl(options.webhookUrl, signSecret, Date.now())
      : options.webhookUrl;

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });
    const data = await readJson(response);
    if (!response.ok) {
      return failure(platform, `机器人请求失败（HTTP ${response.status}）`);
    }
    if (platform === "FEISHU") {
      const code = data?.code ?? data?.StatusCode;
      if (code !== undefined && code !== 0) {
        return failure(
          platform,
          `飞书机器人返回错误（code=${code}）：${data?.msg ?? "未知错误"}`
        );
      }
      return { channel: "ROBOT", platform, ok: true };
    }
    const errcode = data?.errcode;
    if (errcode !== undefined && errcode !== 0) {
      return failure(
        platform,
        `钉钉机器人返回错误（errcode=${errcode}）：${data?.errmsg ?? "未知错误"}`
      );
    }
    return { channel: "ROBOT", platform, ok: true };
  } catch {
    // 不输出原始异常，避免其中可能带出 Webhook 地址或 token。
    return failure(platform, "机器人请求失败（网络错误或超时）");
  }
}
