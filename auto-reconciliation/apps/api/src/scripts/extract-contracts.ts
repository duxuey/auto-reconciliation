import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.js";
import { routeContracts } from "../rest/contracts.js";
import { logger } from "../infra/logger.js";

const docsDir = fileURLToPath(new URL("../../../../docs/contracts/", import.meta.url));

async function main(): Promise<void> {
  // 触发路由注册，收集挂载在路由上的契约元数据
  createApp();

  const paths: Record<string, Record<string, unknown>> = {};
  for (const contract of routeContracts) {
    const method = contract.method.toLowerCase();
    const pathItem = paths[contract.path] ?? {};
    pathItem[method] = {
      summary: contract.summary,
      "x-governance": contract.governance,
      "x-error-codes": contract.errors,
      responses: {
        "200": { description: "成功" }
      },
      ...(contract.examples === undefined ? {} : { examples: contract.examples })
    };
    paths[contract.path] = pathItem;
  }

  const openapi = {
    openapi: "3.0.3",
    info: {
      title: "业再财自动对账系统 API",
      version: "1.0.0",
      description:
        "由路由注册处 zod 契约机械投影；事实源是路由挂载的 zod schema，本文件不是第二份事实"
    },
    paths
  };

  const ledger = {
    generatedFrom: "apps/api/src/rest/routes.ts",
    contractCount: routeContracts.length,
    contracts: routeContracts
  };

  await mkdir(docsDir, { recursive: true });
  await writeFile(
    join(docsDir, "openapi.json"),
    `${JSON.stringify(openapi, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(docsDir, "ledger.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
    "utf8"
  );
  logger.info({
    event: "contracts.extracted",
    contractCount: routeContracts.length,
    output: docsDir
  });
}

main().catch((error: unknown) => {
  logger.error({
    event: "contracts.extract.failed",
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
