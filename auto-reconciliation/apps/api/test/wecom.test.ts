import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWecomTokenCacheForTest,
  sendWecomApp,
  sendWecomWebhook,
  truncateUtf8ByLines
} from "../src/infra/wecom.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const appOptions = {
  corpId: "ww1234567890",
  agentId: "1000002",
  secret: "test-secret",
  toUser: "@all",
  text: "【自动对账】测试"
};

describe("企业微信群机器人", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("成功发送 markdown 消息", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ errcode: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWecomWebhook({
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc",
      markdown: "内容"
    });

    expect(result).toEqual({ channel: "WEBHOOK", ok: true, errcode: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhook/send");
    const body = JSON.parse(String(init.body)) as {
      msgtype: string;
      markdown: { content: string };
    };
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.content).toBe("内容");
  });

  it("业务错误码返回失败且不暴露 URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ errcode: 93000, errmsg: "invalid webhook url" }))
    );

    const result = await sendWecomWebhook({
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key",
      markdown: "内容"
    });

    expect(result.ok).toBe(false);
    expect(result.errcode).toBe(93000);
    expect(result.errorMessage).toContain("93000");
    expect(result.errorMessage).not.toContain("secret-key");
    expect(result.errorMessage).not.toContain("qyapi");
  });

  it("网络异常返回失败", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect timeout")));
    const result = await sendWecomWebhook({
      webhookUrl: "https://example.invalid/hook",
      markdown: "内容"
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("connect timeout");
  });
});

describe("企业微信应用消息", () => {
  beforeEach(() => {
    resetWecomTokenCacheForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetWecomTokenCacheForTest();
  });

  it("先取 token 再发消息，并缓存 token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: "token-1", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await sendWecomApp(appOptions);
    const second = await sendWecomApp(appOptions);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gettoken");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("access_token=token-1");

    const sendBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)
    ) as { msgtype: string; agentid: number; touser: string };
    expect(sendBody.msgtype).toBe("text");
    expect(sendBody.agentid).toBe(1000002);
    expect(sendBody.touser).toBe("@all");
  });

  it("token 失效（42001）时刷新后重试一次", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: "token-1" }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: "token expired" }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: "token-2" }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWecomApp(appOptions);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("access_token=token-2");
  });

  it("参数非法时不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const invalidAgent = await sendWecomApp({ ...appOptions, agentId: "abc" });
    const emptySecret = await sendWecomApp({ ...appOptions, secret: " " });
    const emptyUser = await sendWecomApp({ ...appOptions, toUser: "" });

    expect(invalidAgent.ok).toBe(false);
    expect(emptySecret.ok).toBe(false);
    expect(emptyUser.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("按行截断", () => {
  it("未超限时原样返回", () => {
    expect(truncateUtf8ByLines("短消息", 100)).toBe("短消息");
  });

  it("超限时保留整行并追加提示", () => {
    const text = ["第一行", "第二行", "第三行"].join("\n");
    const truncated = truncateUtf8ByLines(text, 20, "\n…");
    expect(truncated.endsWith("\n…")).toBe(true);
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(20);
    expect(truncated.startsWith("第一行")).toBe(true);
  });

  it("单行超限时按字符安全截断，不破坏多字节字符", () => {
    const text = "对账".repeat(100);
    const truncated = truncateUtf8ByLines(text, 30, "…");
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated).not.toContain("�");
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(30);
  });
});
