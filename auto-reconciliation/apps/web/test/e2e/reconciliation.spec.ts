import { expect, test } from "@playwright/test";

const RP_PAIR_LABEL = "再保↔收付（1 个指标包）";

async function selectPair(page: import("@playwright/test").Page, label: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "对账工作台" })).toBeVisible();
  // 种子历史数据属于 TEST 环境；显式选择 TEST，避免默认环境被手工切换后用例失真。
  await page.getByRole("checkbox").check();
  await page
    .locator("header select")
    .first()
    .selectOption({ label: "TEST · 测试环境" });
  await page.getByRole("button", { name: "对账关系" }).click();
  await page.getByRole("option", { name: label }).click();
  await expect(page.getByText("数据就绪检查")).toBeVisible();
}

test.describe("对账工作台（业务模式）", () => {
  test("按步骤展示对账关系、期间与数据就绪检查", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "对账工作台" })).toBeVisible();
    await expect(page.getByText("选择对账关系与期间")).toBeVisible();
    await page.getByRole("button", { name: "对账关系" }).click();
    await expect(
      page.getByRole("option", { name: RP_PAIR_LABEL })
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "车承保↔车理赔（待配置指标包）" })
    ).toBeDisabled();

    await page.getByRole("option", { name: RP_PAIR_LABEL }).click();
    await expect(page.getByText("数据就绪检查")).toBeVisible();
    await expect(page.getByText("直连源库").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "重新读库" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "开始对账" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "处理差异" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "阶段确认与报表" })
    ).toBeVisible();
  });

  test("业务导航只保留对账业务入口", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "执行记录", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "差异处理", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "调整建议", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "阶段确认", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "对账报表", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "自动对账" })).toBeVisible();
    await expect(page.getByRole("link", { name: "指标包" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "数据接入" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "环境配置" })).toHaveCount(0);
  });

  test("执行记录展示所选对账关系的批次", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "执行记录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "执行记录" })).toBeVisible();
    await expect(page.getByText("再保送收付↔收付账单").first()).toBeVisible();
  });

  test("执行结果展示指标汇总", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "执行记录", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: "再保送收付↔收付账单" }).first();
    await row.getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "指标汇总" })).toBeVisible();
    await expect(page.getByText("每条记录对应金额是否一致").first()).toBeVisible();
  });

  test("差异处理可钻取来源记录并处理", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "差异处理", exact: true }).click();
    await expect(page.getByRole("heading", { name: "差异处理" })).toBeVisible();
    await page.getByPlaceholder("输入保单号或业务键").fill("RPB003");
    const row = page.getByRole("row").filter({ hasText: "RPB003" }).first();
    await row.click();
    await expect(page.getByRole("heading", { name: /差异详情/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "来源记录" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "处理动作" })).toBeVisible();
  });

  test("调整建议按所选对账关系展示", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "调整建议", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "调整建议", level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /调整建议（/ })).toBeVisible();
  });

  test("阶段确认展示阻断指标与签核入口", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "阶段确认", exact: true }).click();
    await expect(page.getByRole("heading", { name: "阶段确认" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "阻断指标" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "确认阶段通过" })
    ).toBeVisible();
  });

  test("报表展示指标结果并支持导出", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "对账报表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "对账报表" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "指标结果" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "差异账龄" })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出报表 CSV" })).toBeVisible();
  });

  test("自动对账页面可查看调度配置与执行记录", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "自动对账" }).click();
    await expect(page).toHaveURL(/\/automation$/);
    await expect(page.getByRole("heading", { name: "自动对账" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "调度配置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "手动执行" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "执行记录" })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存配置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "测试通知" })).toBeVisible();
    await expect(page.getByText(/下次执行：/)).toBeVisible();
    await expect(page.getByText(/执行时直连源库读取/)).toBeVisible();
    await expect(
      page.getByText(/请先在「数据接入」导入或同步/)
    ).toHaveCount(0);

    await page.goto("/advanced/automation");
    await expect(page).toHaveURL(/\/automation$/);
  });
});

test.describe("高级设置", () => {
  test("开启高级模式后可用技术页面与旧路由重定向", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("link", { name: "指标管理" })).toBeVisible();
    await expect(page.getByRole("link", { name: "数据接入" })).toBeVisible();
    await expect(page.getByRole("link", { name: "环境配置" })).toBeVisible();

    await page.goto("/packs");
    await expect(page).toHaveURL(/\/advanced\/packs/);
    await expect(page.getByRole("heading", { name: "指标管理" })).toBeVisible();
    await expect(
      page.getByText(/按系统间对账关系查看指标包与指标明细/)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 新增指标" }).first()).toBeVisible();
  });

  test("环境配置可查看环境、系统 schema 与对账关系", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.getByRole("link", { name: "环境配置" }).click();
    await expect(page.getByRole("heading", { name: "环境与系统配置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "环境", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "TEST", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PROD", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /环境系统 schema/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "对账关系", exact: true })).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "非车承保↔非车理赔", exact: true })
    ).toBeVisible();
  });

  test("环境配置可编辑已保存的环境与系统 schema", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.getByRole("link", { name: "环境配置" }).click();
    await page
      .locator("header select")
      .first()
      .selectOption({ label: "TEST · 测试环境" });

    const envRow = page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "TEST", exact: true })
    });
    await envRow.getByRole("button", { name: "编辑" }).click();
    const envDialog = page.getByRole("dialog");
    await expect(
      envDialog.getByRole("heading", { name: "编辑环境 TEST" })
    ).toBeVisible();
    await expect(envDialog.getByLabel("环境编码")).toBeDisabled();
    await expect(envDialog.getByLabel("主机")).not.toHaveValue("");
    await envDialog.getByRole("button", { name: "保存修改" }).click();
    await expect(envDialog).toBeHidden();
    await expect(page.getByText("环境配置已保存")).toBeVisible();

    const schemaTable = page.locator("table").nth(1);
    await schemaTable.getByRole("button", { name: "编辑" }).first().click();
    const schemaDialog = page.getByRole("dialog");
    await expect(
      schemaDialog.getByRole("heading", { name: /编辑系统 schema/ })
    ).toBeVisible();
    await expect(schemaDialog.getByLabel("schema 键").first()).not.toHaveValue("");
    await schemaDialog.getByRole("button", { name: "保存" }).click();
    await expect(schemaDialog).toBeHidden();
    await expect(page.getByText("环境系统 schema 已保存")).toBeVisible();

    const prodRow = page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "PROD", exact: true })
    });
    await prodRow.getByRole("button", { name: "删除" }).click();
    const deleteEnvDialog = page.getByRole("dialog");
    await expect(
      deleteEnvDialog.getByRole("heading", { name: "删除环境 PROD" })
    ).toBeVisible();
    await deleteEnvDialog.getByRole("button", { name: "取消" }).click();
    await expect(deleteEnvDialog).toBeHidden();
    await expect(page.getByRole("cell", { name: "PROD", exact: true })).toBeVisible();

    await schemaTable.getByRole("button", { name: "删除" }).first().click();
    const deleteSchemaDialog = page.getByRole("dialog");
    await expect(
      deleteSchemaDialog.getByRole("heading", { name: /删除系统 schema/ })
    ).toBeVisible();
    await deleteSchemaDialog.getByRole("button", { name: "取消" }).click();
    await expect(deleteSchemaDialog).toBeHidden();
  });

});
