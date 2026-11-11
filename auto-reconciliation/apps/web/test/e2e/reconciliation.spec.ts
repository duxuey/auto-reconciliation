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
    await expect(
      page.getByRole("heading", { name: "选择对账关系与期间" })
    ).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "执行进度与结果" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "对账报表" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "指标结果" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "差异账龄" })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出报表 CSV" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "处理差异" })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "阶段确认与报表" })
    ).toHaveCount(0);
  });

  test("业务导航只保留对账业务入口", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "对账工作台", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "执行记录", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "差异处理", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "调整建议", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "阶段确认", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "对账报表", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "自动对账", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "指标包" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "数据接入" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "环境配置" })).toHaveCount(0);
  });

  test("执行记录展示所选对账关系的批次", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "执行记录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "执行记录" })).toBeVisible();
    await expect(
      page.getByText("自动对账工作台", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("合约账 / 临分账自动对账")).toHaveCount(0);
    await expect(page.locator("header select")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "执行历史" })).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "执行时间" })
    ).toBeVisible();
    await expect(page.getByLabel("对账关系").last()).toBeVisible();
    await expect(page.getByLabel("指标包")).toBeVisible();
    await expect(page.getByText("手动补跑单个指标包")).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: "再保送收付↔收付账单" }).first()
    ).toBeVisible();

    await page.getByLabel("指标包").selectOption({ index: 1 });
    await expect(page.getByText("共 1 条执行记录")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "再保送收付↔收付账单" }).first()
    ).toBeVisible();

    const pairFilter = page.getByLabel("对账关系").last();
    const currentPair = await pairFilter.inputValue();
    const otherPair = await pairFilter.evaluate((select, current) => {
      return (
        Array.from((select as HTMLSelectElement).options)
          .map((option) => option.value)
          .find((value) => value !== "" && value !== current) ?? ""
      );
    }, currentPair);
    expect(otherPair).not.toBe("");
    await pairFilter.selectOption(otherPair);
    await expect(page.locator("header select")).toHaveCount(0);
    await expect(page.getByLabel("指标包")).toHaveValue("");
  });

  test("执行结果展示指标汇总", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await page.getByRole("link", { name: "执行记录", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: "再保送收付↔收付账单" }).first();
    await row.getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "指标汇总" })).toBeVisible();
    await expect(page.getByText("每条记录对应金额是否一致").first()).toBeVisible();
  });

  test("工作台报表展示指标结果并支持导出", async ({ page }) => {
    await selectPair(page, RP_PAIR_LABEL);
    await expect(page.getByRole("heading", { name: "对账报表" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "指标结果" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "差异账龄" })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出报表 CSV" })).toBeVisible();
  });

  test("自动对账页面展示统计、手动执行与执行记录", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "自动对账", exact: true }).click();
    await expect(page).toHaveURL(/\/automation$/);
    await expect(page.getByRole("heading", { name: "自动对账" })).toBeVisible();
    await expect(
      page.getByText("调度执行、手动对账与通知结果", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("合约账 / 临分账自动对账")).toHaveCount(0);

    await expect(page.getByText("已配置指标", { exact: true })).toBeVisible();
    await expect(page.getByText("最近执行指标", { exact: true })).toBeVisible();
    await expect(page.getByText("最近通过指标", { exact: true })).toBeVisible();
    await expect(page.getByText("最近未通过指标", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "手动执行" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "执行记录" })).toBeVisible();
    await expect(page.getByText(/执行时直连源库读取/)).toBeVisible();

    await expect(page.getByRole("heading", { name: "调度配置" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "保存配置" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "测试通知" })).toHaveCount(0);
    await expect(page.getByText(/下次执行：/)).toHaveCount(0);

    await expect(
      page.getByRole("columnheader", { name: /^关系（/ })
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^批次（成功/ })
    ).toHaveCount(0);

    const firstView = page.getByRole("button", { name: "查看", exact: true }).first();
    if ((await firstView.count()) > 0) {
      await firstView.click();
      await expect(page.getByRole("heading", { name: "执行详情" })).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: /^批次（新建/ })
      ).toHaveCount(0);
    }
  });
});

test.describe("高级设置", () => {
  test("开启高级模式后可用技术页面与旧路由重定向", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("link", { name: "指标管理" })).toBeVisible();
    await expect(page.getByRole("link", { name: "数据接入" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "环境配置" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "自动对账配置", exact: true })
    ).toBeVisible();

    await page.goto("/packs");
    await expect(page).toHaveURL(/\/advanced\/packs/);
    await expect(page.getByRole("heading", { name: "指标管理" })).toBeVisible();
    await expect(
      page.getByText(/按系统间对账关系查看指标包与指标明细/)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 新增指标" }).first()).toBeVisible();
  });

  test("运营总览聚焦指标包健康与差异风险", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.getByRole("link", { name: "运营总览" }).click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole("heading", { name: "对账总览" })).toBeVisible();
    await expect(
      page.getByText("指标包健康与差异风险", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("合约账 / 临分账自动对账")).toHaveCount(0);
    await expect(page.getByText("超期差异", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "指标包健康状态" })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "最近执行结果" })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "最新批次" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: "指标数" })
    ).toHaveCount(0);
  });

  test("自动对账配置独立位于高级设置", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.getByRole("link", { name: "自动对账配置", exact: true }).click();
    await expect(page).toHaveURL(/\/advanced\/automation$/);
    await expect(
      page.getByRole("heading", { name: "自动对账配置" })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "调度配置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存配置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "测试通知" })).toBeVisible();
    await expect(page.getByText(/下次执行：/)).toBeVisible();
  });

  test("指标 SQL 口径可查看、暂存修改并放弃", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.goto("/packs");
    await expect(page.getByRole("heading", { name: "指标管理" })).toBeVisible();

    await page.locator("button").filter({ hasText: "查看/编辑" }).first().click();
    const sqlDialog = page.getByRole("dialog");
    await expect(sqlDialog.getByRole("heading", { name: "指标 SQL 口径" })).toBeVisible();
    await expect(sqlDialog.getByText(/系统不会执行该 SQL/)).toBeVisible();

    const textarea = sqlDialog.getByRole("textbox", { name: /SQL 口径/ });
    await expect(textarea).toHaveValue(/WITH/);
    await textarea.fill("SELECT 1\nFROM dual");
    await sqlDialog.getByRole("button", { name: "应用修改" }).click();
    await expect(sqlDialog).toBeHidden();

    await expect(page.getByText("有未保存修改").first()).toBeVisible();
    await expect(page.getByText(/修改 1 个指标 SQL/).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "保存并发布" }).first()
    ).toBeEnabled();

    await page.getByRole("button", { name: "放弃修改" }).first().click();
    await expect(page.getByText("有未保存修改")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "保存并发布" })).toHaveCount(0);

    await page.getByRole("button", { name: "+ 新增指标" }).first().click();
    const addDialog = page.getByRole("dialog");
    await expect(addDialog.getByRole("heading", { name: "新增指标" })).toBeVisible();
    await expect(addDialog.getByRole("textbox", { name: /SQL 口径/ })).toBeVisible();
    await addDialog.getByRole("button", { name: "取消" }).click();
    await expect(addDialog).toBeHidden();

    const genericToggle = page.getByRole("button", {
      name: /指标包 非车承保↔非车理赔（通用指标）/
    });
    if ((await genericToggle.getAttribute("aria-expanded")) === "false") {
      await genericToggle.click();
    }
    await expect(genericToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("未填写")).toHaveCount(7);
  });

  test("指标管理支持一键展开与折叠指标包", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.getByRole("link", { name: "指标管理" }).click();

    await page.getByRole("button", { name: "全部折叠" }).click();
    await expect(page.getByRole("button", { name: "全部展开" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^展开指标包 / }).first()
    ).toBeVisible();

    await page.getByRole("button", { name: "全部展开" }).click();
    await expect(page.getByRole("button", { name: "全部折叠" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^收起指标包 / }).first()
    ).toBeVisible();
  });

  test("环境配置可查看环境、系统 schema 与对账关系", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.getByRole("link", { name: "环境配置" }).click();
    await expect(page.getByRole("heading", { name: "环境与系统配置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "新增环境", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "环境", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "TEST", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PROD", exact: true })).toBeVisible();
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
    let envDialog = page.getByRole("dialog");
    await expect(
      envDialog.getByRole("heading", { name: "编辑环境 TEST" })
    ).toBeVisible();
    await expect(envDialog.getByLabel("环境编码")).toBeDisabled();
    await expect(envDialog.getByLabel("主机")).not.toHaveValue("");
    await expect(
      envDialog.getByRole("heading", { name: "环境系统 schema" })
    ).toBeVisible();
    await envDialog.getByRole("button", { name: "保存修改" }).click();
    await expect(envDialog).toBeHidden();
    await expect(page.getByText("环境配置已保存")).toBeVisible();

    await envRow.getByRole("button", { name: "编辑" }).click();
    envDialog = page.getByRole("dialog");
    const schemaTable = envDialog.locator("table");
    await schemaTable.getByRole("button", { name: "编辑" }).first().click();
    await expect(envDialog.getByText(/编辑系统 schema/).first()).toBeVisible();
    await expect(envDialog.getByLabel("schema 键").first()).not.toHaveValue("");
    await envDialog.getByRole("button", { name: "保存 schema" }).click();
    await expect(envDialog.getByText("系统 schema 已保存")).toBeVisible();
    await envDialog.getByRole("button", { name: "取消" }).click();
    await expect(envDialog).toBeHidden();

    const prodRow = page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "PROD", exact: true })
    });
    await prodRow.getByRole("button", { name: "删除" }).click();
    const deleteEnvDialog = page
      .getByRole("dialog")
      .filter({ hasText: "删除环境 PROD" });
    await expect(deleteEnvDialog).toBeVisible();
    await deleteEnvDialog.getByRole("button", { name: "取消" }).click();
    await expect(deleteEnvDialog).toBeHidden();
    await expect(page.getByRole("cell", { name: "PROD", exact: true })).toBeVisible();

    await envRow.getByRole("button", { name: "编辑" }).click();
    const schemaEnvDialog = page.getByRole("dialog");
    await schemaEnvDialog
      .locator("table")
      .getByRole("button", { name: "删除" })
      .first()
      .click();
    const deleteSchemaDialog = page
      .getByRole("dialog")
      .filter({ hasText: "删除系统 schema" });
    await expect(deleteSchemaDialog).toBeVisible();
    await deleteSchemaDialog.getByRole("button", { name: "取消" }).click();
    await expect(deleteSchemaDialog).toBeHidden();
    await expect(schemaEnvDialog).toBeVisible();
  });

});
