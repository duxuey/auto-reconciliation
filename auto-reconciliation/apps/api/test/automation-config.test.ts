import { describe, expect, it } from "vitest";
import {
  automationConfigUpdateSchema,
  automationRunListSchema,
  automationRunNowSchema
} from "../src/rest/schemas.js";

const ENV_ID = "01J00000000000000000000000";

const baseConfig = {
  enabled: true,
  runTime: "08:30",
  channel: "WEBHOOK" as const,
  environmentId: ENV_ID,
  webhookUrlEnvKey: "WECOM_WEBHOOK_URL",
  appSecretEnvKey: "WECOM_APP_SECRET"
};

describe("自动对账配置校验", () => {
  it("群机器人配置通过校验", () => {
    expect(automationConfigUpdateSchema.safeParse(baseConfig).success).toBe(true);
  });

  it("执行时间必须是 HH:mm", () => {
    for (const runTime of ["8:30", "24:00", "08:60", "0830", ""]) {
      expect(
        automationConfigUpdateSchema.safeParse({ ...baseConfig, runTime }).success,
        runTime
      ).toBe(false);
    }
    expect(
      automationConfigUpdateSchema.safeParse({ ...baseConfig, runTime: "23:59" }).success
    ).toBe(true);
    expect(
      automationConfigUpdateSchema.safeParse({ ...baseConfig, runTime: "00:00" }).success
    ).toBe(true);
  });

  it("企业应用渠道必须填写 CorpID、数字 AgentID 与接收人", () => {
    const app = {
      ...baseConfig,
      channel: "APP" as const,
      appCorpId: "ww1234567890",
      appAgentId: "1000002",
      toUser: "@all"
    };
    expect(automationConfigUpdateSchema.safeParse(app).success).toBe(true);
    expect(
      automationConfigUpdateSchema.safeParse({ ...app, appCorpId: undefined }).success
    ).toBe(false);
    expect(
      automationConfigUpdateSchema.safeParse({ ...app, appAgentId: "abc" }).success
    ).toBe(false);
    expect(
      automationConfigUpdateSchema.safeParse({ ...app, toUser: " " }).success
    ).toBe(false);
  });

  it("两者都发时同时校验两类渠道", () => {
    const both = {
      ...baseConfig,
      channel: "BOTH" as const,
      appCorpId: "ww1234567890",
      appAgentId: "1000002",
      toUser: "user1|user2"
    };
    expect(automationConfigUpdateSchema.safeParse(both).success).toBe(true);
    expect(
      automationConfigUpdateSchema.safeParse({
        ...both,
        webhookUrlEnvKey: "1BAD"
      }).success
    ).toBe(false);
  });

  it("飞书/钉钉机器人渠道只要求 Webhook 环境变量名与 @ 接收人", () => {
    const robot = {
      ...baseConfig,
      channel: "ROBOT" as const,
      webhookUrlEnvKey: "FEISHU_ROBOT_WEBHOOK_URL",
      toUser: "ou_1|ou_2"
    };
    expect(automationConfigUpdateSchema.safeParse(robot).success).toBe(true);
    expect(
      automationConfigUpdateSchema.safeParse({
        ...robot,
        webhookUrlEnvKey: ""
      }).success
    ).toBe(false);
    expect(
      automationConfigUpdateSchema.safeParse({ ...robot, toUser: " " }).success
    ).toBe(false);
  });

  it("环境变量名只允许字母、数字和下划线", () => {
    expect(
      automationConfigUpdateSchema.safeParse({
        ...baseConfig,
        webhookUrlEnvKey: "WECOM-WEBHOOK"
      }).success
    ).toBe(false);
    expect(
      automationConfigUpdateSchema.safeParse({
        ...baseConfig,
        webhookUrlEnvKey: ""
      }).success
    ).toBe(false);
  });

  it("环境 ID 必须为 26 位", () => {
    expect(
      automationConfigUpdateSchema.safeParse({
        ...baseConfig,
        environmentId: "short"
      }).success
    ).toBe(false);
  });
});

describe("手动执行与列表参数", () => {
  it("默认通知开启且日期可省略", () => {
    const parsed = automationRunNowSchema.parse({});
    expect(parsed.notify).toBe(true);
    expect(parsed.periodStartDate).toBeUndefined();
    expect(parsed.periodEndDate).toBeUndefined();
  });

  it("日期格式非法时拒绝", () => {
    expect(
      automationRunNowSchema.safeParse({
        periodStartDate: "2026/10/01",
        periodEndDate: "2026-10-02"
      }).success
    ).toBe(false);
  });

  it("列表 limit 强制转换并限制范围", () => {
    expect(automationRunListSchema.parse({ limit: "30" }).limit).toBe(30);
    expect(automationRunListSchema.parse({}).limit).toBe(20);
    expect(automationRunListSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(automationRunListSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
