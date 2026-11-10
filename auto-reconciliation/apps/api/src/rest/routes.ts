import { File } from "node:buffer";
import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  createPack,
  createPackVersion,
  getPackById,
  listDatasets,
  listPackVersions,
  listPacks,
  publishPackVersion,
  upsertDataset,
  validatePackVersionConfig
} from "../application/catalog.js";
import {
  getImportBatchById,
  importFileBatch,
  listImportBatches,
  listImportRowErrors,
  syncDataset
} from "../application/imports.js";
import {
  cancelRun,
  createRun,
  getRunById,
  getRunDiffs,
  getRunSummary,
  listRuns,
  replayRun
} from "../application/runs.js";
import {
  approveAdjustment,
  assignDiff,
  commentDiff,
  createAdjustment,
  getAdjustmentsByIds,
  getDiffById,
  investigateDiff,
  listAdjustments,
  listDiffs,
  rejectAdjustment,
  reopenDiff,
  resolveDiff,
  submitAdjustment,
  writeOffDiff
} from "../application/diffs.js";
import {
  createEnvironment,
  getEnvironmentById,
  listEnvironmentSystems,
  listEnvironments,
  listPairsView,
  listSystems,
  testEnvironmentConnection,
  updateEnvironment,
  upsertEnvironmentSystem
} from "../application/environments.js";
import { getGate, signOffGate } from "../application/gates.js";
import {
  getDiffAging,
  getFinanceScopeReport,
  getMetricsReport,
  getOverview
} from "../application/reports.js";
import { getJobById } from "../application/jobs.js";
import {
  deleteAutomationRun,
  getAutomationConfig,
  getAutomationRunById,
  listAutomationRuns,
  startManualRun,
  testAutomationNotification,
  updateAutomationConfig
} from "../application/automation.js";
import {
  getAutomationScheduleInfo,
  refreshAutomationSchedule
} from "../application/automation-scheduler.js";
import { AppError } from "../domain/errors.js";
import { recordContract, toHonoPath } from "./contracts.js";
import {
  adjustmentCreateSchema,
  adjustmentExportQuerySchema,
  automationConfigUpdateSchema,
  automationRunListSchema,
  automationRunNowSchema,
  datasetUpsertSchema,
  diffAssignSchema,
  diffCommentSchema,
  diffInvestigateSchema,
  diffListQuerySchema,
  diffReopenSchema,
  diffResolveSchema,
  diffWriteOffSchema,
  environmentCreateSchema,
  environmentSystemUpsertSchema,
  environmentUpdateSchema,
  financeScopeQuerySchema,
  gateQuerySchema,
  gateSignOffSchema,
  importMetaSchema,
  limitSchema,
  metricQuerySchema,
  packCreateSchema,
  packVersionCreateSchema,
  publishSchema,
  runCreateSchema,
  runDiffsQuerySchema,
  runListSchema,
  scopeQuerySchema,
  stageSchema,
  syncSchema
} from "./schemas.js";
import { jsonValidator, paramValidator, queryValidator } from "./validators.js";

export type AppEnv = {
  Variables: {
    traceId: string;
    actor: string;
  };
};

type AppContext = Context<AppEnv>;

function ok<T>(c: AppContext, data: T) {
  return c.json({ data, traceId: c.get("traceId") });
}

function created<T>(c: AppContext, data: T) {
  return c.json({ data, traceId: c.get("traceId") }, 201);
}

function accepted<T>(c: AppContext, data: T) {
  return c.json({ data, traceId: c.get("traceId") }, 202);
}

function param(c: AppContext, name: string): string {
  const value = c.req.param(name);
  if (value === undefined || value === "") {
    throw new AppError(
      "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT",
      `缺少路径参数 ${name}`
    );
  }
  return value;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function registerRoutes(app: Hono<AppEnv>): void {
  const base = "/api/reconciliation";

  // ---------- 环境 / 系统 / 对账关系 ----------
  recordContract({
    method: "GET",
    path: `${base}/environments`,
    summary: "查询环境列表",
    governance: "L1",
    errors: []
  });
  app.get(toHonoPath(`${base}/environments`), async (c) =>
    ok(c, await listEnvironments())
  );

  recordContract({
    method: "POST",
    path: `${base}/environments`,
    summary: "创建环境",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT",
      "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"
    ]
  });
  app.post(
    toHonoPath(`${base}/environments`),
    jsonValidator(environmentCreateSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => created(c, await createEnvironment(c.req.valid("json"), c.get("actor")))
  );

  recordContract({
    method: "GET",
    path: `${base}/environments/{id}`,
    summary: "查询环境详情",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/environments/{id}`), async (c) =>
    ok(c, await getEnvironmentById(param(c, "id")))
  );

  recordContract({
    method: "PATCH",
    path: `${base}/environments/{id}`,
    summary: "更新环境",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"]
  });
  app.patch(
    toHonoPath(`${base}/environments/{id}`),
    jsonValidator(environmentUpdateSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) =>
      ok(c, await updateEnvironment(param(c, "id"), c.req.valid("json"), c.get("actor")))
  );

  recordContract({
    method: "POST",
    path: `${base}/environments/{id}/test-connection`,
    summary: "测试环境数据库连接",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"]
  });
  app.post(toHonoPath(`${base}/environments/{id}/test-connection`), async (c) =>
    ok(c, await testEnvironmentConnection(param(c, "id")))
  );

  recordContract({
    method: "GET",
    path: `${base}/environments/{id}/systems`,
    summary: "查询环境下各系统 schema 配置",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/environments/{id}/systems`), async (c) =>
    ok(c, await listEnvironmentSystems(param(c, "id")))
  );

  recordContract({
    method: "PUT",
    path: `${base}/environments/{id}/systems`,
    summary: "配置环境下系统 schema",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
      "BIZ_RECONCILIATION_SYSTEM_NOT_FOUND"
    ]
  });
  app.put(
    toHonoPath(`${base}/environments/{id}/systems`),
    jsonValidator(environmentSystemUpsertSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) =>
      ok(
        c,
        await upsertEnvironmentSystem(
          { ...c.req.valid("json"), environmentId: param(c, "id") },
          c.get("actor")
        )
      )
  );

  recordContract({
    method: "GET",
    path: `${base}/systems`,
    summary: "查询系统列表",
    governance: "L1",
    errors: []
  });
  app.get(toHonoPath(`${base}/systems`), async (c) => ok(c, await listSystems()));

  recordContract({
    method: "GET",
    path: `${base}/pairs`,
    summary: "查询对账关系列表",
    governance: "L1",
    errors: []
  });
  app.get(toHonoPath(`${base}/pairs`), async (c) => ok(c, await listPairsView()));

  // ---------- 指标包 ----------
  recordContract({
    method: "GET",
    path: `${base}/packs`,
    summary: "查询指标包列表",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/packs`),
    queryValidator(scopeQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => ok(c, await listPacks(c.req.valid("query").pairId))
  );

  recordContract({
    method: "POST",
    path: `${base}/packs`,
    summary: "创建指标包",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_PACK_ALREADY_EXISTS",
      "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"
    ]
  });
  app.post(
    toHonoPath(`${base}/packs`),
    jsonValidator(packCreateSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return created(c, await createPack(body, c.get("actor")));
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/packs/{id}`,
    summary: "查询指标包详情",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_PACK_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/packs/{id}`), async (c) =>
    ok(c, await getPackById(param(c, "id")))
  );

  recordContract({
    method: "GET",
    path: `${base}/packs/{id}/versions`,
    summary: "查询指标包版本列表",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_PACK_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/packs/{id}/versions`), async (c) =>
    ok(c, await listPackVersions(param(c, "id")))
  );

  recordContract({
    method: "POST",
    path: `${base}/packs/{id}/versions`,
    summary: "创建指标包草稿版本",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_PACK_NOT_FOUND",
      "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT"
    ]
  });
  app.post(
    toHonoPath(`${base}/packs/{id}/versions`),
    jsonValidator(packVersionCreateSchema, "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return created(
        c,
        await createPackVersion(param(c, "id"), body, c.get("actor"))
      );
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/packs/{id}/versions/{vid}/validate`,
    summary: "校验指标包版本配置",
    governance: "L1",
    errors: [
      "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT",
      "BIZ_RECONCILIATION_PACK_VERSION_NOT_FOUND"
    ]
  });
  app.post(toHonoPath(`${base}/packs/{id}/versions/{vid}/validate`), async (c) => {
    const versions = await listPackVersions(param(c, "id"));
    const version = versions.find((item) => item.id === param(c, "vid"));
    if (version === undefined) {
      throw new AppError(
        "BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT",
        "规则版本不存在"
      );
    }
    return ok(c, await validatePackVersionConfig(version.configJson));
  });

  recordContract({
    method: "POST",
    path: `${base}/packs/{id}/versions/{vid}/publish`,
    summary: "发布指标包版本（L3，dryRun/confirm）",
    governance: "L3",
    errors: [
      "BIZ_RECONCILIATION_PACK_VERSION_CONFLICT",
      "BIZ_RECONCILIATION_PACK_VERSION_DRYRUN_FAILED"
    ]
  });
  app.post(
    toHonoPath(`${base}/packs/{id}/versions/{vid}/publish`),
    jsonValidator(publishSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(
        c,
        await publishPackVersion(
          param(c, "id"),
          param(c, "vid"),
          body,
          c.get("actor")
        )
      );
    }
  );

  // ---------- 数据集与导入 ----------
  recordContract({
    method: "GET",
    path: `${base}/datasets`,
    summary: "查询数据集列表",
    governance: "L1",
    errors: []
  });
  app.get(toHonoPath(`${base}/datasets`), async (c) => ok(c, await listDatasets()));

  recordContract({
    method: "PUT",
    path: `${base}/datasets/{code}`,
    summary: "新增或更新数据集映射",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_IMPORT_INVALID_INPUT"]
  });
  app.put(
    toHonoPath(`${base}/datasets/{code}`),
    jsonValidator(datasetUpsertSchema, "BIZ_RECONCILIATION_IMPORT_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(
        c,
        await upsertDataset(
          { ...body, datasetCode: param(c, "code") },
          c.get("actor")
        )
      );
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/datasets/{code}/sync`,
    summary: "只读同步数据集（READONLY_SQL）",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_DATASET_NOT_FOUND",
      "BIZ_RECONCILIATION_DATASET_SYNC_UNAVAILABLE"
    ]
  });
  app.post(
    toHonoPath(`${base}/datasets/{code}/sync`),
    jsonValidator(syncSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return accepted(
        c,
        await syncDataset({
          datasetCode: param(c, "code"),
          environmentId: body.environmentId,
          periodStartDate: body.periodStartDate,
          periodEndDate: body.periodEndDate,
          actor: c.get("actor")
        })
      );
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/import-batches`,
    summary: "上传 CSV/JSON 并导入数据集",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_DATASET_NOT_FOUND",
      "BIZ_RECONCILIATION_IMPORT_INVALID_INPUT"
    ]
  });
  app.post(toHonoPath(`${base}/import-batches`), async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) {
      throw new AppError("BIZ_RECONCILIATION_IMPORT_INVALID_INPUT", "缺少上传文件 file");
    }
    const datasetCode = firstString(form.datasetCode);
    const periodStartDate = firstString(form.periodStartDate);
    const periodEndDate = firstString(form.periodEndDate);
    const formatRaw = firstString(form.format);
    const environmentId = firstString(form.environmentId);
    const meta = importMetaSchema.parse({
      datasetCode,
      periodStartDate,
      periodEndDate,
      environmentId,
      format: formatRaw === "CSV" || formatRaw === "JSON" ? formatRaw : undefined
    });
    const content = await file.text();
    const result = await importFileBatch({
      datasetCode: meta.datasetCode,
      fileName: file.name,
      content,
      format: meta.format,
      environmentId: meta.environmentId,
      periodStartDate: meta.periodStartDate,
      periodEndDate: meta.periodEndDate,
      actor: c.get("actor")
    });
    return accepted(c, result);
  });

  recordContract({
    method: "GET",
    path: `${base}/import-batches`,
    summary: "查询导入批次",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/import-batches`),
    queryValidator(
      scopeQuerySchema.extend({ limit: limitSchema.shape.limit }),
      "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"
    ),
    async (c) => {
      const query = c.req.valid("query");
      return ok(
        c,
        await listImportBatches(query.limit ?? 100, query.environmentId)
      );
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/import-batches/{id}`,
    summary: "查询导入批次详情",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_IMPORT_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/import-batches/{id}`), async (c) =>
    ok(c, await getImportBatchById(param(c, "id")))
  );

  recordContract({
    method: "GET",
    path: `${base}/import-batches/{id}/errors`,
    summary: "查询导入行错误",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_IMPORT_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/import-batches/{id}/errors`), async (c) =>
    ok(c, await listImportRowErrors(param(c, "id")))
  );

  // ---------- 执行与结果 ----------
  recordContract({
    method: "POST",
    path: `${base}/runs`,
    summary: "创建指标执行批次",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_RUN_INVALID_INPUT",
      "BIZ_RECONCILIATION_RUN_NOT_FOUND"
    ]
  });
  app.post(
    toHonoPath(`${base}/runs`),
    jsonValidator(runCreateSchema, "BIZ_RECONCILIATION_RUN_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      const result = await createRun({ ...body, actor: c.get("actor") });
      return accepted(c, { run: result.run, created: result.created });
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/runs`,
    summary: "查询执行批次列表",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/runs`),
    queryValidator(runListSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const query = c.req.valid("query");
      return ok(
        c,
        await listRuns({
          limit: query.limit,
          environmentId: query.environmentId,
          pairId: query.pairId,
          packId: query.packId
        })
      );
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/runs/{id}`,
    summary: "查询执行批次",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_RUN_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/runs/{id}`), async (c) =>
    ok(c, await getRunById(param(c, "id")))
  );

  recordContract({
    method: "GET",
    path: `${base}/runs/{id}/summary`,
    summary: "查询指标汇总（SQL 同款口径）",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_RUN_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/runs/{id}/summary`), async (c) =>
    ok(c, await getRunSummary(param(c, "id")))
  );

  recordContract({
    method: "GET",
    path: `${base}/runs/{id}/diffs`,
    summary: "查询执行批次差异明细",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_RUN_NOT_FOUND"]
  });
  app.get(
    toHonoPath(`${base}/runs/{id}/diffs`),
    queryValidator(runDiffsQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const query = c.req.valid("query");
      return ok(
        c,
        await getRunDiffs(param(c, "id"), {
          metricCode: query.metricCode,
          status: query.status,
          limit: query.limit
        })
      );
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/runs/{id}/cancel`,
    summary: "取消执行批次",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_RUN_CONFLICT"]
  });
  app.post(toHonoPath(`${base}/runs/{id}/cancel`), async (c) =>
    ok(c, await cancelRun(param(c, "id"), c.get("actor")))
  );

  recordContract({
    method: "POST",
    path: `${base}/runs/{id}/replay`,
    summary: "按当前数据重放执行批次",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_RUN_NOT_FOUND"]
  });
  app.post(toHonoPath(`${base}/runs/{id}/replay`), async (c) =>
    accepted(c, await replayRun(param(c, "id"), c.get("actor")))
  );

  // ---------- 差异处理 ----------
  recordContract({
    method: "GET",
    path: `${base}/diffs`,
    summary: "查询差异明细",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/diffs`),
    queryValidator(diffListQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => ok(c, await listDiffs(c.req.valid("query")))
  );

  recordContract({
    method: "GET",
    path: `${base}/diffs/{id}`,
    summary: "查询差异详情与源记录钻取",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_DIFF_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/diffs/{id}`), async (c) =>
    ok(c, await getDiffById(param(c, "id")))
  );

  recordContract({
    method: "POST",
    path: `${base}/diffs/{id}/assign`,
    summary: "指派差异",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"]
  });
  app.post(
    toHonoPath(`${base}/diffs/{id}/assign`),
    jsonValidator(diffAssignSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(
        c,
        await assignDiff(param(c, "id"), body.assignee, c.get("actor"), {
          expectedVersion: body.expectedVersion
        })
      );
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/diffs/{id}/investigate`,
    summary: "开始调查差异",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"]
  });
  app.post(
    toHonoPath(`${base}/diffs/{id}/investigate`),
    jsonValidator(diffInvestigateSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(
        c,
        await investigateDiff(param(c, "id"), c.get("actor"), {
          note: body.note,
          expectedVersion: body.expectedVersion
        })
      );
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/diffs/{id}/resolve`,
    summary: "解决差异",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"]
  });
  app.post(
    toHonoPath(`${base}/diffs/{id}/resolve`),
    jsonValidator(diffResolveSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(c, await resolveDiff(param(c, "id"), c.get("actor"), body));
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/diffs/{id}/write-off`,
    summary: "差异核销（L3，confirm）",
    governance: "L3",
    errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"]
  });
  app.post(
    toHonoPath(`${base}/diffs/{id}/write-off`),
    jsonValidator(diffWriteOffSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(c, await writeOffDiff(param(c, "id"), c.get("actor"), body));
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/diffs/{id}/reopen`,
    summary: "重开差异",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"]
  });
  app.post(
    toHonoPath(`${base}/diffs/{id}/reopen`),
    jsonValidator(diffReopenSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(c, await reopenDiff(param(c, "id"), c.get("actor"), body));
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/diffs/{id}/comments`,
    summary: "添加差异处理备注",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_DIFF_NOT_FOUND"]
  });
  app.post(
    toHonoPath(`${base}/diffs/{id}/comments`),
    jsonValidator(diffCommentSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(c, await commentDiff(param(c, "id"), c.get("actor"), body.note));
    }
  );

  // ---------- 调整建议 ----------
  recordContract({
    method: "POST",
    path: `${base}/diffs/{id}/adjustments`,
    summary: "创建调整建议",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_DIFF_NOT_FOUND"]
  });
  app.post(
    toHonoPath(`${base}/diffs/{id}/adjustments`),
    jsonValidator(adjustmentCreateSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return created(c, await createAdjustment(param(c, "id"), body, c.get("actor")));
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/adjustments`,
    summary: "查询调整建议",
    governance: "L1",
    errors: []
  });
  app.get(toHonoPath(`${base}/adjustments`), async (c) =>
    ok(
      c,
      await listAdjustments({
        status: c.req.query("status"),
        pairId: c.req.query("pairId"),
        environmentId: c.req.query("environmentId")
      })
    )
  );

  recordContract({
    method: "POST",
    path: `${base}/adjustments/{id}/submit`,
    summary: "提交调整建议",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_ADJUSTMENT_CONFLICT"]
  });
  app.post(toHonoPath(`${base}/adjustments/{id}/submit`), async (c) =>
    ok(c, await submitAdjustment(param(c, "id"), c.get("actor")))
  );

  recordContract({
    method: "POST",
    path: `${base}/adjustments/{id}/approve`,
    summary: "审批调整建议（L3，confirm）",
    governance: "L3",
    errors: ["BIZ_RECONCILIATION_ADJUSTMENT_CONFLICT"]
  });
  app.post(
    toHonoPath(`${base}/adjustments/{id}/approve`),
    jsonValidator(z.object({ confirm: z.boolean() }), "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const body = c.req.valid("json");
      return ok(c, await approveAdjustment(param(c, "id"), c.get("actor"), body));
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/adjustments/{id}/reject`,
    summary: "驳回调整建议",
    governance: "L2",
    errors: ["BIZ_RECONCILIATION_ADJUSTMENT_CONFLICT"]
  });
  app.post(toHonoPath(`${base}/adjustments/{id}/reject`), async (c) =>
    ok(c, await rejectAdjustment(param(c, "id"), c.get("actor")))
  );

  recordContract({
    method: "GET",
    path: `${base}/adjustments/export`,
    summary: "导出调整建议 CSV",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"]
  });
  app.get(
    toHonoPath(`${base}/adjustments/export`),
    queryValidator(adjustmentExportQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const query = c.req.valid("query");
      const ids = query.ids
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== "");
      const rows = await getAdjustmentsByIds(ids);
      const header = [
        "adjustmentNo",
        "diffId",
        "adjustmentType",
        "amount",
        "currency",
        "status",
        "reason"
      ].join(",");
      const body = rows
        .map((row) =>
          [
            row.adjustmentNo,
            row.diffId,
            row.adjustmentType,
            row.amount,
            row.currency,
            row.adjustmentStatus,
            row.reason
          ]
            .map(csvCell)
            .join(",")
        )
        .join("\n");
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", 'attachment; filename="adjustments.csv"');
      return c.body(`﻿${header}\n${body}\n`);
    }
  );

  // ---------- 闸门与报表 ----------
  recordContract({
    method: "GET",
    path: `${base}/gates/{stage}`,
    summary: "查询阶段闸门",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_GATE_NOT_FOUND"]
  });
  app.get(
    toHonoPath(`${base}/gates/{stage}`),
    paramValidator(z.object({ stage: stageSchema }), "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    queryValidator(gateQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const param = c.req.valid("param");
      const query = c.req.valid("query");
      return ok(
        c,
        await getGate(param.stage, query.periodStartDate, query.periodEndDate, {
          environmentId: query.environmentId,
          pairId: query.pairId
        })
      );
    }
  );

  recordContract({
    method: "POST",
    path: `${base}/gates/{stage}/sign-off`,
    summary: "闸门签核（L3，dryRun/confirm）",
    governance: "L3",
    errors: ["BIZ_RECONCILIATION_GATE_CONFLICT"]
  });
  app.post(
    toHonoPath(`${base}/gates/{stage}/sign-off`),
    paramValidator(z.object({ stage: stageSchema }), "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    jsonValidator(
      gateSignOffSchema.merge(gateQuerySchema),
      "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"
    ),
    async (c) => {
      const param = c.req.valid("param");
      const body = c.req.valid("json");
      return ok(
        c,
        await signOffGate(
          param.stage,
          body.periodStartDate,
          body.periodEndDate,
          { dryRun: body.dryRun, confirm: body.confirm },
          c.get("actor"),
          { environmentId: body.environmentId, pairId: body.pairId }
        )
      );
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/reports/overview`,
    summary: "对账概览",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/reports/overview`),
    queryValidator(scopeQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => ok(c, await getOverview(c.req.valid("query")))
  );

  recordContract({
    method: "GET",
    path: `${base}/reports/metrics`,
    summary: "指标结果报表",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/reports/metrics`),
    queryValidator(metricQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => ok(c, await getMetricsReport(c.req.valid("query")))
  );

  recordContract({
    method: "GET",
    path: `${base}/reports/diffs/aging`,
    summary: "差异账龄报表",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/reports/diffs/aging`),
    queryValidator(scopeQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => ok(c, await getDiffAging(c.req.valid("query")))
  );

  recordContract({
    method: "GET",
    path: `${base}/reports/finance-scope`,
    summary: "全辖财务核对报表清单",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/reports/finance-scope`),
    queryValidator(financeScopeQuerySchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const query = c.req.valid("query");
      return ok(
        c,
        await getFinanceScopeReport(query.periodStartDate, query.periodEndDate, {
          environmentId: query.environmentId,
          pairId: query.pairId
        })
      );
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/jobs/{id}`,
    summary: "查询作业状态",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_JOB_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/jobs/{id}`), async (c) =>
    ok(c, await getJobById(param(c, "id")))
  );

  // ---------- 每日自动对账 ----------
  recordContract({
    method: "GET",
    path: `${base}/automation/config`,
    summary: "查询自动对账配置与调度状态",
    governance: "L1",
    errors: []
  });
  app.get(toHonoPath(`${base}/automation/config`), async (c) =>
    ok(c, {
      ...(await getAutomationConfig()),
      ...getAutomationScheduleInfo()
    })
  );

  recordContract({
    method: "PUT",
    path: `${base}/automation/config`,
    summary: "保存自动对账配置",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
      "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"
    ]
  });
  app.put(
    toHonoPath(`${base}/automation/config`),
    jsonValidator(automationConfigUpdateSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => {
      const result = await updateAutomationConfig(
        c.req.valid("json"),
        c.get("actor")
      );
      refreshAutomationSchedule();
      return ok(c, result);
    }
  );

  recordContract({
    method: "GET",
    path: `${base}/automation/runs`,
    summary: "查询自动对账执行记录",
    governance: "L1",
    errors: []
  });
  app.get(
    toHonoPath(`${base}/automation/runs`),
    queryValidator(automationRunListSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) => ok(c, await listAutomationRuns(c.req.valid("query").limit))
  );

  recordContract({
    method: "GET",
    path: `${base}/automation/runs/{id}`,
    summary: "查询自动对账执行详情",
    governance: "L1",
    errors: ["BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND"]
  });
  app.get(toHonoPath(`${base}/automation/runs/{id}`), async (c) =>
    ok(c, await getAutomationRunById(param(c, "id")))
  );

  recordContract({
    method: "DELETE",
    path: `${base}/automation/runs/{id}`,
    summary: "删除自动对账执行记录",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND",
      "BIZ_RECONCILIATION_AUTOMATION_CONFLICT"
    ]
  });
  app.delete(toHonoPath(`${base}/automation/runs/{id}`), async (c) =>
    ok(c, await deleteAutomationRun(param(c, "id"), c.get("actor")))
  );

  recordContract({
    method: "POST",
    path: `${base}/automation/run-now`,
    summary: "立即执行一次自动对账",
    governance: "L2",
    errors: [
      "BIZ_RECONCILIATION_AUTOMATION_INVALID_INPUT",
      "BIZ_RECONCILIATION_AUTOMATION_CONFLICT"
    ]
  });
  app.post(
    toHonoPath(`${base}/automation/run-now`),
    jsonValidator(automationRunNowSchema, "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"),
    async (c) =>
      accepted(c, await startManualRun(c.req.valid("json"), c.get("actor")))
  );

  recordContract({
    method: "POST",
    path: `${base}/automation/test-notify`,
    summary: "发送自动对账测试通知",
    governance: "L2",
    errors: []
  });
  app.post(toHonoPath(`${base}/automation/test-notify`), async (c) =>
    ok(c, await testAutomationNotification())
  );
}
