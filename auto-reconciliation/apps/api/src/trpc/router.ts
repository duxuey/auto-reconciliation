import { initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { resolveActor, resolveTraceId } from "../infra/actor.js";
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
  listImportRowErrors
} from "../application/imports.js";
import {
  cancelRun,
  createRun,
  createRunsForPair,
  getRunById,
  getRunDiffs,
  getRunSummary,
  listRuns,
  replayRun
} from "../application/runs.js";
import { getPairReadiness } from "../application/readiness.js";
import {
  deleteAutomationRun,
  getAutomationConfig,
  getAutomationOverview,
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
import {
  approveAdjustment,
  assignDiff,
  commentDiff,
  createAdjustment,
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
  deleteEnvironment,
  deleteEnvironmentSystem,
  getEnvironmentById,
  getPairById,
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
import {
  adjustmentCreateSchema,
  adjustmentListQuerySchema,
  datasetUpsertSchema,
  diffAssignSchema,
  diffCommentSchema,
  diffInvestigateSchema,
  diffListQuerySchema,
  diffReopenSchema,
  diffResolveSchema,
  automationConfigUpdateSchema,
  automationRunListSchema,
  automationRunNowSchema,
  diffWriteOffSchema,
  environmentCreateSchema,
  environmentSystemUpsertSchema,
  environmentUpdateSchema,
  financeScopeQuerySchema,
  gateQuerySchema,
  gateSignOffSchema,
  limitSchema,
  metricQuerySchema,
  packCreateSchema,
  packVersionCreateSchema,
  pairReadinessQuerySchema,
  publishSchema,
  runCreateForPairSchema,
  runCreateSchema,
  runDiffsQuerySchema,
  runListSchema,
  scopeQuerySchema,
  stageSchema
} from "../rest/schemas.js";

export interface TrpcContext {
  actor: string;
  traceId: string;
}

export function createContext(options: FetchCreateContextFnOptions): TrpcContext {
  return {
    actor: resolveActor(options.req.headers.get("x-actor") ?? undefined),
    traceId: resolveTraceId(options.req.headers.get("x-trace-id") ?? undefined)
  };
}

const t = initTRPC.context<TrpcContext>().create();

const publicProcedure = t.procedure;

const packRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "指标包列表", governance: "L1", errors: [] } })
    .input(z.object({ pairId: z.string().length(26).optional() }).optional())
    .query(async ({ input }) => listPacks(input?.pairId)),
  byId: publicProcedure
    .meta({ contract: { summary: "指标包详情", governance: "L1", errors: ["BIZ_RECONCILIATION_PACK_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getPackById(input.id)),
  versions: publicProcedure
    .meta({ contract: { summary: "指标包版本列表", governance: "L1", errors: [] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => listPackVersions(input.id)),
  validate: publicProcedure
    .meta({ contract: { summary: "校验版本配置", governance: "L1", errors: ["BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT"] } })
    .input(z.object({ packId: z.string().length(26), versionId: z.string().length(26) }))
    .query(async ({ input }) => {
      const versions = await listPackVersions(input.packId);
      const version = versions.find((item) => item.id === input.versionId);
      if (version === undefined) {
        throw new Error("规则版本不存在");
      }
      return validatePackVersionConfig(version.configJson);
    }),
  create: publicProcedure
    .meta({ contract: { summary: "创建指标包", governance: "L2", errors: ["BIZ_RECONCILIATION_PACK_ALREADY_EXISTS"] } })
    .input(packCreateSchema)
    .mutation(async ({ input, ctx }) => createPack(input, ctx.actor)),
  createVersion: publicProcedure
    .meta({ contract: { summary: "创建草稿版本", governance: "L2", errors: ["BIZ_RECONCILIATION_PACK_VERSION_INVALID_INPUT"] } })
    .input(packVersionCreateSchema.extend({ packId: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { packId, ...rest } = input;
      return createPackVersion(packId, rest, ctx.actor);
    }),
  publish: publicProcedure
    .meta({ contract: { summary: "发布版本", governance: "L3", errors: ["BIZ_RECONCILIATION_PACK_VERSION_CONFLICT"] } })
    .input(publishSchema.extend({ packId: z.string().length(26), versionId: z.string().length(26) }))
    .mutation(async ({ input, ctx }) =>
      publishPackVersion(
        input.packId,
        input.versionId,
        { dryRun: input.dryRun, confirm: input.confirm },
        ctx.actor
      )
    )
});

const datasetRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "数据集列表", governance: "L1", errors: [] } })
    .query(async () => listDatasets()),
  upsert: publicProcedure
    .meta({ contract: { summary: "更新数据集映射", governance: "L2", errors: ["BIZ_RECONCILIATION_IMPORT_INVALID_INPUT"] } })
    .input(datasetUpsertSchema.extend({ datasetCode: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => upsertDataset(input, ctx.actor))
});

const importBatchRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "导入批次列表", governance: "L1", errors: [] } })
    .input(scopeQuerySchema.extend({ limit: limitSchema.shape.limit }).optional())
    .query(async ({ input }) =>
      listImportBatches(input?.limit ?? 100, input?.environmentId)
    ),
  byId: publicProcedure
    .meta({ contract: { summary: "导入批次详情", governance: "L1", errors: ["BIZ_RECONCILIATION_IMPORT_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getImportBatchById(input.id)),
  errors: publicProcedure
    .meta({ contract: { summary: "导入行错误", governance: "L1", errors: ["BIZ_RECONCILIATION_IMPORT_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => listImportRowErrors(input.id)),
  importText: publicProcedure
    .meta({ contract: { summary: "文本导入（tRPC 调试用）", governance: "L2", errors: ["BIZ_RECONCILIATION_IMPORT_INVALID_INPUT"] } })
    .input(
      z.object({
        datasetCode: z.string().min(1),
        fileName: z.string().min(1),
        content: z.string(),
        format: z.enum(["CSV", "JSON"]).optional(),
        environmentId: z.string().length(26).optional(),
        periodStartDate: z.string(),
        periodEndDate: z.string()
      })
    )
    .mutation(async ({ input, ctx }) => importFileBatch({ ...input, actor: ctx.actor }))
});

const runRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "执行批次列表", governance: "L1", errors: [] } })
    .input(runListSchema.optional())
    .query(async ({ input }) =>
      listRuns({
        limit: input?.limit ?? 50,
        environmentId: input?.environmentId,
        pairId: input?.pairId,
        periodStartDate: input?.periodStartDate,
        periodEndDate: input?.periodEndDate
      })
    ),
  byId: publicProcedure
    .meta({ contract: { summary: "执行批次详情", governance: "L1", errors: ["BIZ_RECONCILIATION_RUN_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getRunById(input.id)),
  summary: publicProcedure
    .meta({ contract: { summary: "指标汇总", governance: "L1", errors: ["BIZ_RECONCILIATION_RUN_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getRunSummary(input.id)),
  diffs: publicProcedure
    .meta({ contract: { summary: "执行批次差异", governance: "L1", errors: [] } })
    .input(runDiffsQuerySchema.extend({ id: z.string().length(26) }))
    .query(async ({ input }) =>
      getRunDiffs(input.id, {
        metricCode: input.metricCode,
        status: input.status,
        limit: input.limit
      })
    ),
  create: publicProcedure
    .meta({ contract: { summary: "创建执行批次", governance: "L2", errors: ["BIZ_RECONCILIATION_RUN_INVALID_INPUT"] } })
    .input(runCreateSchema)
    .mutation(async ({ input, ctx }) => createRun({ ...input, actor: ctx.actor })),
  createForPair: publicProcedure
    .meta({ contract: { summary: "按对账关系批量创建执行批次", governance: "L2", errors: ["BIZ_RECONCILIATION_PAIR_NOT_FOUND", "BIZ_RECONCILIATION_RUN_INVALID_INPUT"] } })
    .input(runCreateForPairSchema)
    .mutation(async ({ input, ctx }) => createRunsForPair({ ...input, actor: ctx.actor })),
  cancel: publicProcedure
    .meta({ contract: { summary: "取消执行批次", governance: "L2", errors: ["BIZ_RECONCILIATION_RUN_CONFLICT"] } })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => cancelRun(input.id, ctx.actor)),
  replay: publicProcedure
    .meta({ contract: { summary: "重放执行批次", governance: "L2", errors: ["BIZ_RECONCILIATION_RUN_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => replayRun(input.id, ctx.actor))
});

const diffRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "差异列表", governance: "L1", errors: [] } })
    .input(diffListQuerySchema.optional())
    .query(async ({ input }) => listDiffs(input ?? {})),
  byId: publicProcedure
    .meta({ contract: { summary: "差异详情", governance: "L1", errors: ["BIZ_RECONCILIATION_DIFF_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getDiffById(input.id)),
  assign: publicProcedure
    .meta({ contract: { summary: "指派差异", governance: "L2", errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"] } })
    .input(diffAssignSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      return assignDiff(id, rest.assignee, ctx.actor, {
        expectedVersion: rest.expectedVersion
      });
    }),
  investigate: publicProcedure
    .meta({ contract: { summary: "调查差异", governance: "L2", errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"] } })
    .input(diffInvestigateSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      return investigateDiff(id, ctx.actor, rest);
    }),
  resolve: publicProcedure
    .meta({ contract: { summary: "解决差异", governance: "L2", errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"] } })
    .input(diffResolveSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      return resolveDiff(id, ctx.actor, rest);
    }),
  writeOff: publicProcedure
    .meta({ contract: { summary: "核销差异", governance: "L3", errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"] } })
    .input(diffWriteOffSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      return writeOffDiff(id, ctx.actor, rest);
    }),
  reopen: publicProcedure
    .meta({ contract: { summary: "重开差异", governance: "L2", errors: ["BIZ_RECONCILIATION_DIFF_CONFLICT"] } })
    .input(diffReopenSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      return reopenDiff(id, ctx.actor, rest);
    }),
  comment: publicProcedure
    .meta({ contract: { summary: "差异备注", governance: "L2", errors: ["BIZ_RECONCILIATION_DIFF_NOT_FOUND"] } })
    .input(diffCommentSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => commentDiff(input.id, ctx.actor, input.note)),
  createAdjustment: publicProcedure
    .meta({ contract: { summary: "创建调整建议", governance: "L2", errors: ["BIZ_RECONCILIATION_DIFF_NOT_FOUND"] } })
    .input(adjustmentCreateSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      return createAdjustment(id, rest, ctx.actor);
    })
});

const adjustmentRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "调整建议列表", governance: "L1", errors: [] } })
    .input(adjustmentListQuerySchema.optional())
    .query(async ({ input }) => listAdjustments(input ?? {})),
  submit: publicProcedure
    .meta({ contract: { summary: "提交调整建议", governance: "L2", errors: [] } })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => submitAdjustment(input.id, ctx.actor)),
  approve: publicProcedure
    .meta({ contract: { summary: "审批调整建议", governance: "L3", errors: [] } })
    .input(z.object({ id: z.string().length(26), confirm: z.boolean() }))
    .mutation(async ({ input, ctx }) =>
      approveAdjustment(input.id, ctx.actor, { confirm: input.confirm })
    ),
  reject: publicProcedure
    .meta({ contract: { summary: "驳回调整建议", governance: "L2", errors: [] } })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => rejectAdjustment(input.id, ctx.actor))
});

const gateRouter = t.router({
  get: publicProcedure
    .meta({ contract: { summary: "阶段闸门", governance: "L1", errors: ["BIZ_RECONCILIATION_GATE_NOT_FOUND"] } })
    .input(z.object({ stage: stageSchema }).merge(gateQuerySchema))
    .query(async ({ input }) =>
      getGate(input.stage, input.periodStartDate, input.periodEndDate, {
        environmentId: input.environmentId,
        pairId: input.pairId
      })
    ),
  signOff: publicProcedure
    .meta({ contract: { summary: "闸门签核", governance: "L3", errors: ["BIZ_RECONCILIATION_GATE_CONFLICT"] } })
    .input(gateSignOffSchema.merge(gateQuerySchema).extend({ stage: stageSchema }))
    .mutation(async ({ input, ctx }) =>
      signOffGate(
        input.stage,
        input.periodStartDate,
        input.periodEndDate,
        { dryRun: input.dryRun, confirm: input.confirm },
        ctx.actor,
        { environmentId: input.environmentId, pairId: input.pairId }
      )
    )
});

const reportRouter = t.router({
  overview: publicProcedure
    .meta({ contract: { summary: "对账概览", governance: "L1", errors: [] } })
    .input(scopeQuerySchema.optional())
    .query(async ({ input }) => getOverview(input ?? {})),
  metrics: publicProcedure
    .meta({ contract: { summary: "指标报表", governance: "L1", errors: [] } })
    .input(metricQuerySchema.optional())
    .query(async ({ input }) => getMetricsReport(input ?? {})),
  aging: publicProcedure
    .meta({ contract: { summary: "差异账龄", governance: "L1", errors: [] } })
    .input(scopeQuerySchema.optional())
    .query(async ({ input }) => getDiffAging(input ?? {})),
  financeScope: publicProcedure
    .meta({ contract: { summary: "全辖财务报表", governance: "L1", errors: [] } })
    .input(financeScopeQuerySchema)
    .query(async ({ input }) =>
      getFinanceScopeReport(input.periodStartDate, input.periodEndDate, {
        environmentId: input.environmentId,
        pairId: input.pairId
      })
    )
});

const environmentRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "环境列表", governance: "L1", errors: [] } })
    .query(async () => listEnvironments()),
  byId: publicProcedure
    .meta({ contract: { summary: "环境详情", governance: "L1", errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getEnvironmentById(input.id)),
  create: publicProcedure
    .meta({ contract: { summary: "创建环境", governance: "L2", errors: ["BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT"] } })
    .input(environmentCreateSchema)
    .mutation(async ({ input, ctx }) => createEnvironment(input, ctx.actor)),
  update: publicProcedure
    .meta({ contract: { summary: "更新环境", governance: "L2", errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"] } })
    .input(environmentUpdateSchema.extend({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      return updateEnvironment(id, rest, ctx.actor);
    }),
  testConnection: publicProcedure
    .meta({ contract: { summary: "测试环境数据库连接", governance: "L2", errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input }) => testEnvironmentConnection(input.id)),
  delete: publicProcedure
    .meta({ contract: { summary: "删除环境", governance: "L2", errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND", "BIZ_RECONCILIATION_ENVIRONMENT_CONFLICT"] } })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => deleteEnvironment(input.id, ctx.actor)),
  systems: publicProcedure
    .meta({ contract: { summary: "环境已配置系统与 schema", governance: "L1", errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => listEnvironmentSystems(input.id)),
  upsertSystem: publicProcedure
    .meta({ contract: { summary: "配置环境下的系统 schema", governance: "L2", errors: ["BIZ_RECONCILIATION_SYSTEM_NOT_FOUND"] } })
    .input(environmentSystemUpsertSchema.extend({ environmentId: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => upsertEnvironmentSystem(input, ctx.actor)),
  deleteSystem: publicProcedure
    .meta({ contract: { summary: "删除环境系统 schema 配置", governance: "L2", errors: ["BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => deleteEnvironmentSystem(input.id, ctx.actor))
});

const systemRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "系统列表", governance: "L1", errors: [] } })
    .query(async () => listSystems())
});

const pairRouter = t.router({
  list: publicProcedure
    .meta({ contract: { summary: "对账关系列表", governance: "L1", errors: [] } })
    .query(async () => listPairsView()),
  byId: publicProcedure
    .meta({ contract: { summary: "对账关系详情", governance: "L1", errors: ["BIZ_RECONCILIATION_PAIR_NOT_FOUND"] } })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getPairById(input.id))
});

const workbenchRouter = t.router({
  readiness: publicProcedure
    .meta({ contract: { summary: "对账数据就绪检查", governance: "L1", errors: ["BIZ_RECONCILIATION_PAIR_NOT_FOUND"] } })
    .input(pairReadinessQuerySchema)
    .query(async ({ input }) => getPairReadiness(input))
});

const automationRouter = t.router({
  overview: publicProcedure
    .meta({
      contract: { summary: "自动对账总览", governance: "L1", errors: [] }
    })
    .query(async () => getAutomationOverview()),
  getConfig: publicProcedure
    .meta({
      contract: { summary: "自动对账配置与调度状态", governance: "L1", errors: [] }
    })
    .query(async () => ({
      ...(await getAutomationConfig()),
      ...getAutomationScheduleInfo()
    })),
  updateConfig: publicProcedure
    .meta({
      contract: {
        summary: "保存自动对账配置",
        governance: "L2",
        errors: [
          "BIZ_RECONCILIATION_ENVIRONMENT_NOT_FOUND",
          "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT"
        ]
      }
    })
    .input(automationConfigUpdateSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await updateAutomationConfig(input, ctx.actor);
      refreshAutomationSchedule();
      return result;
    }),
  listRuns: publicProcedure
    .meta({
      contract: { summary: "自动对账执行记录", governance: "L1", errors: [] }
    })
    .input(automationRunListSchema.optional())
    .query(async ({ input }) => listAutomationRuns(input?.limit ?? 20)),
  getRun: publicProcedure
    .meta({
      contract: {
        summary: "自动对账执行详情",
        governance: "L1",
        errors: ["BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND"]
      }
    })
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ input }) => getAutomationRunById(input.id)),
  deleteRun: publicProcedure
    .meta({
      contract: {
        summary: "删除自动对账执行记录",
        governance: "L2",
        errors: [
          "BIZ_RECONCILIATION_AUTOMATION_NOT_FOUND",
          "BIZ_RECONCILIATION_AUTOMATION_CONFLICT"
        ]
      }
    })
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input, ctx }) => deleteAutomationRun(input.id, ctx.actor)),
  runNow: publicProcedure
    .meta({
      contract: {
        summary: "立即执行一次自动对账",
        governance: "L2",
        errors: [
          "BIZ_RECONCILIATION_AUTOMATION_INVALID_INPUT",
          "BIZ_RECONCILIATION_AUTOMATION_CONFLICT"
        ]
      }
    })
    .input(automationRunNowSchema)
    .mutation(async ({ input, ctx }) => startManualRun(input, ctx.actor)),
  testNotify: publicProcedure
    .meta({
      contract: { summary: "发送自动对账测试通知", governance: "L2", errors: [] }
    })
    .mutation(async () => testAutomationNotification())
});

export const appRouter = t.router({
  environment: environmentRouter,
  system: systemRouter,
  pair: pairRouter,
  pack: packRouter,
  dataset: datasetRouter,
  importBatch: importBatchRouter,
  run: runRouter,
  diff: diffRouter,
  adjustment: adjustmentRouter,
  gate: gateRouter,
  report: reportRouter,
  workbench: workbenchRouter,
  automation: automationRouter
});

export type AppRouter = typeof appRouter;
