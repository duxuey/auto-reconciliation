const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "对账关系" }).click();
  await page.screenshot({ path: "C:/Users/Jelncy/AppData/Local/Temp/workbench-select.png" });
  await page.getByRole("option", { name: /再保↔收付/ }).click();
  await page.getByRole("button", { name: "期间开始" }).click();
  await page.screenshot({ path: "C:/Users/Jelncy/AppData/Local/Temp/workbench-date.png" });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
