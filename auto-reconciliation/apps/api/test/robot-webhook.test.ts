import { describe, expect, it } from "vitest";
import {
  buildDingTalkPayload,
  buildFeishuPayload,
  detectRobotPlatform,
  parseRobotTargets,
  signDingTalkUrl
} from "../src/infra/robot-webhook.js";

describe("detectRobotPlatform", () => {
  it("识别飞书与钉钉 Webhook 地址", () => {
    expect(
      detectRobotPlatform(
        "https://open.feishu.cn/open-apis/bot/v2/hook/abc"
      )
    ).toBe("FEISHU");
    expect(
      detectRobotPlatform(
        "https://oapi.dingtalk.com/robot/send?access_token=abc"
      )
    ).toBe("DINGTALK");
    expect(detectRobotPlatform("https://example.com/webhook")).toBeNull();
    expect(detectRobotPlatform("not-a-url")).toBeNull();
  });
});

describe("signDingTalkUrl", () => {
  it("按钉钉加签规则追加 timestamp 与 sign", () => {
    const signed = signDingTalkUrl(
      "https://oapi.dingtalk.com/robot/send?access_token=abc",
      "SECtest",
      1700000000000
    );
    const url = new URL(signed);
    expect(url.searchParams.get("access_token")).toBe("abc");
    expect(url.searchParams.get("timestamp")).toBe("1700000000000");
    expect(url.searchParams.get("sign")).toBe(
      "aZLLrriXgn05YbwaGR7knYsLeJADjr9NwLaNNKpxh4g="
    );
  });
});

describe("parseRobotTargets", () => {
  it("支持 |、逗号与空白分隔并去重空白项", () => {
    expect(parseRobotTargets("ou_1|@ou_2, 13800000000；@all")).toEqual([
      "ou_1",
      "ou_2",
      "13800000000",
      "all"
    ]);
    expect(parseRobotTargets("")).toEqual([]);
    expect(parseRobotTargets(null)).toEqual([]);
  });
});

describe("buildFeishuPayload", () => {
  it("使用文本消息并追加 at 标签", () => {
    const payload = buildFeishuPayload("对账完成", ["ou_1", "all"]) as {
      msg_type: string;
      content: { text: string };
    };
    expect(payload.msg_type).toBe("text");
    expect(payload.content.text).toBe(
      "对账完成\n\n<at user_id=\"ou_1\"></at> <at user_id=\"all\"></at>"
    );
  });

  it("没有接收人时不追加 at 标签", () => {
    const payload = buildFeishuPayload("对账完成", []) as {
      content: { text: string };
    };
    expect(payload.content.text).toBe("对账完成");
  });
});

describe("buildDingTalkPayload", () => {
  it("手机号进 atMobiles，其余进 atUserIds，all 设置 isAtAll", () => {
    const payload = buildDingTalkPayload("自动对账结果", "内容", [
      "13800000000",
      "manager123",
      "all"
    ]) as {
      msgtype: string;
      markdown: { title: string; text: string };
      at: { atMobiles: string[]; atUserIds: string[]; isAtAll: boolean };
    };
    expect(payload.msgtype).toBe("markdown");
    expect(payload.markdown.title).toBe("自动对账结果");
    expect(payload.markdown.text).toContain("@13800000000");
    expect(payload.markdown.text).toContain("@manager123");
    expect(payload.at.atMobiles).toEqual(["13800000000"]);
    expect(payload.at.atUserIds).toEqual(["manager123"]);
    expect(payload.at.isAtAll).toBe(true);
  });

  it("没有接收人时 isAtAll 为 false 且正文不变", () => {
    const payload = buildDingTalkPayload("标题", "内容", []) as {
      markdown: { text: string };
      at: { atMobiles: string[]; atUserIds: string[]; isAtAll: boolean };
    };
    expect(payload.markdown.text).toBe("内容");
    expect(payload.at).toEqual({ atMobiles: [], atUserIds: [], isAtAll: false });
  });
});
