import { describe, expect, it } from "vitest";
import type {
  AutomationPairSummary,
  AutomationSummary
} from "../src/domain/automation.js";
import { buildAutomationMessage } from "../src/application/automation.js";

function pair(
  overrides: Partial<AutomationPairSummary> = {}
): AutomationPairSummary {
  return {
    pairId: "01J0000000000000000000001",
    pairCode: "RP_RI",
    pairName: "再保↔收付",
    environmentId: "01J0000000000000000000000",
    status: "SUCCEEDED",
    createdCount: 1,
    reusedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    metricTotal: 3,
    failMetricCount: 1,
    diffCount: 5,
    runs: [
      {
        runId: "01J0000000000000000000002",
        runNo: "RUN-1",
        packCode: "RP_RI",
        packName: "再保送收付↔收付账单",
        runStatus: "SUCCEEDED",
        metricTotal: 3,
        failMetricCount: 1,
        diffCount: 5,
        reused: false
      }
    ],
    skippedPacks: [],
    failedPacks: [],
    ...overrides
  };
}

function summary(overrides: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    pairCount: 1,
    pairExecutedCount: 1,
    pairNoDataCount: 0,
    pairFailedCount: 0,
    batchCount: 1,
    batchReusedCount: 0,
    batchSucceededCount: 1,
    batchFailedCount: 0,
    metricTotal: 3,
    failMetricCount: 1,
    diffCount: 5,
    pairs: [pair()],
    failedMetrics: [],
    ...overrides
  };
}

const period = {
  businessDate: "2026-11-07",
  periodStartDate: "2026-11-06",
  periodEndDate: "2026-11-06"
};

describe("企业微信对账消息", () => {
  it("Markdown 版包含期间、触发与汇总数字", () => {
    const message = buildAutomationMessage(summary(), period, {
      format: "markdown",
      triggerType: "SCHEDULE"
    });
    expect(message).toContain("【自动对账】2026-11-06 执行结果");
    expect(message).toContain("执行状态：成功");
    expect(message).toContain("触发方式：定时");
    expect(message).toContain("对账期间：2026-11-06");
    expect(message).toContain("执行概况");
    expect(message).toContain(
      "对账关系：共 1 个，已执行 1 个，无数据 0 个，失败 0 个"
    );
    expect(message).toContain("指标结果：共 3 项，未通过 1 项");
    expect(message).toContain("差异笔数：5 条");
    expect(message).toContain("再保↔收付：未通过 1 项，差异 5 条");
    expect(message).not.toContain("批次");
  });

  it("纯文本版去掉 Markdown 加粗标记", () => {
    const message = buildAutomationMessage(summary(), period, {
      format: "text",
      triggerType: "MANUAL"
    });
    expect(message.startsWith("【自动对账】")).toBe(true);
    expect(message).not.toContain("**");
    expect(message).toContain("触发方式：手动");
  });

  it("无启用关系时给出明确说明", () => {
    const message = buildAutomationMessage(
      summary({
        pairCount: 0,
        pairExecutedCount: 0,
        batchCount: 0,
        metricTotal: 0,
        failMetricCount: 0,
        diffCount: 0,
        pairs: []
      }),
      period,
      { format: "markdown", triggerType: "CATCH_UP" }
    );
    expect(message).toContain("本次没有启用的对账关系");
    expect(message).toContain("触发方式：启动补跑");
  });

  it("无就绪数据与失败关系分别标注原因", () => {
    const message = buildAutomationMessage(
      summary({
        pairExecutedCount: 1,
        pairNoDataCount: 1,
        pairFailedCount: 1,
        pairs: [
          pair(),
          pair({ pairName: "车承保↔车理赔", status: "NO_DATA" }),
          pair({
            pairName: "非车理赔↔再保",
            status: "FAILED",
            failedPacks: [{ packCode: "CLM_RI_MAIN", message: "缺少已发布版本" }]
          })
        ]
      }),
      { businessDate: "2026-11-07", periodStartDate: "2026-10-01", periodEndDate: "2026-10-31" },
      { format: "markdown", triggerType: "SCHEDULE" }
    );
    expect(message).toContain("对账期间：2026-10-01 ~ 2026-10-31");
    expect(message).toContain("车承保↔车理赔：源库期间内无数据");
    expect(message).toContain("非车理赔↔再保：执行失败");
    expect(message).toContain("缺少已发布版本");
  });

  it("未通过指标最多列出 5 条", () => {
    const failedMetrics = Array.from({ length: 8 }, (_, index) => ({
      runId: `run-${index}`,
      packCode: "RP_RI",
      packName: "再保送收付",
      metricCode: `M${index}`,
      metricName: `指标 ${index}`,
      failCount: index + 1
    }));
    const message = buildAutomationMessage(summary({ failedMetrics }), period, {
      format: "markdown",
      triggerType: "SCHEDULE"
    });
    expect(message).toContain("未通过指标（前 5）");
    expect(message).toContain("指标 0");
    expect(message).toContain("指标 4");
    expect(message).not.toContain("指标 5");
  });

  it("消息不包含密钥、Webhook 地址或内部字段", () => {
    const message = buildAutomationMessage(summary(), period, {
      format: "markdown",
      triggerType: "SCHEDULE"
    });
    expect(message).not.toContain("WECOM");
    expect(message).not.toContain("qyapi");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("tenant");
  });
});
