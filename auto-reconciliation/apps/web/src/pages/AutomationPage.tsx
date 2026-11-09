import { Fragment, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { DatePicker } from "../components/ui/date-picker";
import { Field, Input } from "../components/ui/input";
import { SelectMenu } from "../components/ui/select-menu";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { TimePicker } from "../components/ui/time-picker";
import { useToast } from "../components/ui/toast";
import { friendlyError } from "../lib/errors";
import { formatDate, formatMoney } from "../lib/format";
import {
  AUTOMATION_CHANNEL_LABELS,
  AUTOMATION_NOTIFY_STATUS_LABELS,
  AUTOMATION_PAIR_STATUS_LABELS,
  AUTOMATION_RUN_STATUS_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  diffTypeLabel,
  labelOf,
  statusTone
} from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

type Channel = "WEBHOOK" | "APP" | "BOTH" | "ROBOT";

interface ConfigForm {
  enabled: boolean;
  runTime: string;
  channel: Channel;
  environmentId: string;
  webhookUrlEnvKey: string;
  appCorpId: string;
  appAgentId: string;
  appSecretEnvKey: string;
  toUser: string;
}

interface SummaryPairRunView {
  runId: string;
  runNo: string;
  packCode: string;
  packName: string;
  runStatus: string;
  metricTotal: number;
  failMetricCount: number;
  diffCount: number;
  reused: boolean;
}

interface SummaryPairView {
  pairId: string;
  pairCode: string;
  pairName: string;
  status: string;
  createdCount: number;
  reusedCount: number;
  metricTotal: number;
  failMetricCount: number;
  diffCount: number;
  runs: SummaryPairRunView[];
  skippedPacks: Array<{ packCode: string; reason: string }>;
  failedPacks: Array<{ packCode: string; message: string }>;
}

interface SummaryView {
  pairCount: number;
  pairExecutedCount: number;
  pairs: SummaryPairView[];
  failedMetrics: Array<{
    runId: string;
    packCode: string;
    packName: string;
    metricCode: string;
    metricName: string;
    failCount: number;
  }>;
}

function isRunningStatus(status: string): boolean {
  return status === "PENDING" || status === "RUNNING";
}

/** 某条未通过指标对应的差异明细（失败的具体记录）。 */
function FailedMetricDiffs({
  runId,
  metricCode
}: {
  runId: string;
  metricCode: string;
}) {
  const query = trpc.diff.list.useQuery({ runId, metricCode, limit: 200 });
  const diffs = query.data ?? [];

  return (
    <QueryState isLoading={query.isLoading} error={query.error}>
      {diffs.length === 0 ? (
        <div className="text-xs text-slate-500">
          该指标没有可展示的差异明细（差异可能已处置、删除或不属于本指标）。
        </div>
      ) : (
        <>
          <div className="mb-1 text-[11px] text-slate-500">
            明细为该指标产生的差异记录；条数类指标（总条数/业务键数）为一条汇总差异，失败条数即两侧数量差。
          </div>
          <Table>
          <thead>
            <tr>
              <Th>业务键</Th>
              <Th>差异类型</Th>
              <Th>字段</Th>
              <Th>左侧值</Th>
              <Th>右侧值</Th>
              <Th>差异值</Th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((diff) => (
              <tr key={diff.id}>
                <Td
                  className="max-w-[260px] truncate font-mono text-[11px]"
                  title={diff.businessKeyText}
                >
                  {diff.businessKeyText}
                </Td>
                <Td className="text-xs">{diffTypeLabel(diff.diffType)}</Td>
                <Td className="font-mono text-[11px]">{diff.fieldCode ?? "-"}</Td>
                <Td className="text-right font-mono text-xs">
                  {formatMoney(diff.leftValue)}
                </Td>
                <Td className="text-right font-mono text-xs">
                  {formatMoney(diff.rightValue)}
                </Td>
                <Td className="text-right font-mono text-xs">
                  {formatMoney(diff.diffValue)}
                </Td>
              </tr>
            ))}
          </tbody>
          </Table>
        </>
      )}
    </QueryState>
  );
}

export function AutomationPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { environments } = useScope();
  const configQuery = trpc.automation.getConfig.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.inFlight === true ? 3000 : false
  });
  const runsQuery = trpc.automation.listRuns.useQuery(
    { limit: 20 },
    {
      refetchInterval: (query) => {
        const rows = query.state.data;
        return rows?.some((row) => isRunningStatus(row.runStatus)) === true
          ? 3000
          : false;
      }
    }
  );

  const [form, setForm] = useState<ConfigForm | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notify, setNotify] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  useEffect(() => {
    const data = configQuery.data;
    if (data === undefined || form !== null) {
      return;
    }
    setForm({
      enabled: data.enabled,
      runTime: data.runTime,
      channel: data.channel,
      environmentId: data.environmentId,
      webhookUrlEnvKey: data.webhookUrlEnvKey,
      appCorpId: data.appCorpId ?? "",
      appAgentId: data.appAgentId ?? "",
      appSecretEnvKey: data.appSecretEnvKey,
      toUser: data.toUser ?? ""
    });
    setPeriodStart(data.defaultPeriodStartDate);
    setPeriodEnd(data.defaultPeriodEndDate);
  }, [configQuery.data, form]);

  const detailQuery = trpc.automation.getRun.useQuery(
    { id: selectedId ?? "" },
    {
      enabled: selectedId !== null,
      refetchInterval: (query) => {
        const run = query.state.data;
        return run !== undefined && isRunningStatus(run.runStatus) ? 3000 : false;
      }
    }
  );

  const updateConfig = trpc.automation.updateConfig.useMutation({
    onSuccess: async (result) => {
      setForm({
        enabled: result.enabled,
        runTime: result.runTime,
        channel: result.channel,
        environmentId: result.environmentId,
        webhookUrlEnvKey: result.webhookUrlEnvKey,
        appCorpId: result.appCorpId ?? "",
        appAgentId: result.appAgentId ?? "",
        appSecretEnvKey: result.appSecretEnvKey,
        toUser: result.toUser ?? ""
      });
      toast.success("自动对账配置已保存");
      await utils.automation.getConfig.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, true))
  });

  const runNow = trpc.automation.runNow.useMutation({
    onSuccess: async (result) => {
      toast.success("已提交执行，可在下方执行记录查看进度。");
      setSelectedId(result.automationRunId);
      await utils.automation.listRuns.invalidate();
      await utils.automation.getConfig.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, true))
  });

  const deleteRun = trpc.automation.deleteRun.useMutation({
    onSuccess: async (_result, variables) => {
      toast.success("自动对账记录已删除");
      if (selectedId === variables.id) {
        setSelectedId(null);
      }
      setDeletingId(null);
      await utils.automation.listRuns.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, true))
  });

  const testNotify = trpc.automation.testNotify.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    },
    onError: (error) => toast.error(friendlyError(error, true))
  });

  const config = configQuery.data;
  const runs = runsQuery.data ?? [];
  const detail = detailQuery.data;
  const summary = (detail?.summaryExt ?? null) as unknown as SummaryView | null;

  function patchForm(patch: Partial<ConfigForm>): void {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }

  function saveConfig(): void {
    if (form === null) {
      return;
    }
    if (form.environmentId === "") {
      toast.error("请选择执行环境");
      return;
    }
    if (form.channel !== "APP" && form.webhookUrlEnvKey.trim() === "") {
      toast.error("请填写机器人 Webhook 环境变量名");
      return;
    }
    if (form.channel === "ROBOT") {
      if (form.toUser.trim() === "") {
        toast.error("请填写需要 @ 的接收人");
        return;
      }
    }
    if (form.channel === "APP" || form.channel === "BOTH") {
      if (form.appCorpId.trim() === "") {
        toast.error("请填写企业微信 CorpID");
        return;
      }
      if (form.appAgentId.trim() === "") {
        toast.error("请填写企业应用 AgentID");
        return;
      }
      if (!/^\d{1,10}$/.test(form.appAgentId.trim())) {
        toast.error("AgentID 必须为数字");
        return;
      }
      if (form.toUser.trim() === "") {
        toast.error("请填写接收人成员账号");
        return;
      }
    }
    updateConfig.mutate({
      enabled: form.enabled,
      runTime: form.runTime,
      channel: form.channel,
      environmentId: form.environmentId,
      webhookUrlEnvKey: form.webhookUrlEnvKey.trim(),
      appCorpId: form.appCorpId.trim() === "" ? undefined : form.appCorpId.trim(),
      appAgentId:
        form.appAgentId.trim() === "" ? undefined : form.appAgentId.trim(),
      appSecretEnvKey: form.appSecretEnvKey.trim(),
      toUser: form.toUser.trim() === "" ? undefined : form.toUser.trim()
    });
  }

  function submitRun(): void {
    if (periodStart === "" || periodEnd === "") {
      toast.error("请填写对账期间");
      return;
    }
    runNow.mutate({
      periodStartDate: periodStart,
      periodEndDate: periodEnd,
      notify
    });
  }

  return (
    <div>
      <PageHeader
        title="自动对账"
        description="每天按设定时间对全部启用关系执行 T-1 对账，并通过企业微信或飞书/钉钉机器人发送结果；密钥只保存环境变量名。"
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>调度配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <QueryState isLoading={configQuery.isLoading} error={configQuery.error}>
              {form === null ? null : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          form.enabled ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                      />
                      <span className="text-xs font-medium text-slate-700">
                        {form.enabled ? "自动对账已启用" : "自动对账未启用"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                        {AUTOMATION_CHANNEL_LABELS[form.channel] ?? form.channel}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-500">
                      下次执行：
                      {form.enabled
                        ? config?.nextRunAt === null || config?.nextRunAt === undefined
                          ? "保存后计算"
                          : formatDate(config.nextRunAt)
                        : "未启用"}
                    </span>
                  </div>

                  <section className="space-y-2.5">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <span className="h-3 w-0.5 rounded-full bg-blue-500" />
                      基本设置
                    </h3>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition hover:border-blue-300 hover:bg-blue-50/40">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-blue-600"
                        checked={form.enabled}
                        onChange={(event) => patchForm({ enabled: event.target.checked })}
                      />
                      <span>
                        <span className="block text-xs font-medium text-slate-700">
                          启用每日自动对账
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          按自然日执行，期间为前一天；服务重启后会补跑当天遗漏的一次。
                        </span>
                      </span>
                    </label>
                  </section>

                  <section className="space-y-2.5">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <span className="h-3 w-0.5 rounded-full bg-blue-500" />
                      执行计划
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="执行时间">
                        <TimePicker
                          ariaLabel="执行时间"
                          value={form.runTime}
                          onChange={(value) => patchForm({ runTime: value })}
                        />
                      </Field>
                      <Field label="执行环境">
                        <SelectMenu
                          ariaLabel="执行环境"
                          placeholder="请选择环境"
                          value={form.environmentId}
                          options={environments.map((item) => ({
                            value: item.id,
                            label: `${item.envCode} · ${item.envName}`
                          }))}
                          onChange={(value) => patchForm({ environmentId: value })}
                        />
                      </Field>
                    </div>
                  </section>

                  <div className="border-t border-slate-100" />

                  <section className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <span className="h-3 w-0.5 rounded-full bg-blue-500" />
                        通知设置
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {form.channel !== "APP" ? (
                          <Badge
                            tone={config?.webhookConfigured === true ? "success" : "neutral"}
                          >
                            Webhook {config?.webhookConfigured === true ? "已配置" : "未配置"}
                          </Badge>
                        ) : null}
                        {form.channel === "ROBOT" ? (
                          <>
                            <Badge
                              tone={
                                config?.appSecretConfigured === true ? "success" : "neutral"
                              }
                            >
                              加签密钥{" "}
                              {config?.appSecretConfigured === true ? "已配置" : "未配置"}
                            </Badge>
                            <Badge
                              tone={form.toUser.trim() === "" ? "warning" : "success"}
                            >
                              @接收人 {form.toUser.trim() === "" ? "未填写" : "已填写"}
                            </Badge>
                          </>
                        ) : null}
                        {form.channel === "APP" || form.channel === "BOTH" ? (
                          <Badge
                            tone={
                              config?.appFieldsConfigured === true ? "success" : "neutral"
                            }
                          >
                            应用参数{" "}
                            {config?.appFieldsConfigured === true ? "已填写" : "未填写"}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="通知渠道">
                        <SelectMenu
                          ariaLabel="通知渠道"
                          value={form.channel}
                          options={(["WEBHOOK", "ROBOT", "APP", "BOTH"] as const).map(
                            (code) => ({
                              value: code,
                              label: AUTOMATION_CHANNEL_LABELS[code] ?? code
                            })
                          )}
                          onChange={(value) =>
                            patchForm({ channel: value as Channel })
                          }
                        />
                      </Field>
                      <Field
                        label={
                          form.channel === "ROBOT"
                            ? "机器人 Webhook 环境变量名"
                            : "Webhook 环境变量名"
                        }
                      >
                        <Input
                          value={form.webhookUrlEnvKey}
                          onChange={(event) =>
                            patchForm({ webhookUrlEnvKey: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </section>

                  {form.channel === "ROBOT" ? (
                    <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="@ 接收人">
                          <Input
                            value={form.toUser}
                            placeholder="open_id / 手机号 / userid，多个用 | 分隔；all 表示 @所有人"
                            onChange={(event) => patchForm({ toUser: event.target.value })}
                          />
                        </Field>
                        <Field label="加签密钥环境变量名（可选）">
                          <Input
                            value={form.appSecretEnvKey}
                            placeholder="如 DINGTALK_ROBOT_SECRET，仅保存变量名"
                            onChange={(event) =>
                              patchForm({ appSecretEnvKey: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        群机器人只能发到群并 @ 指定成员；密钥在执行时从部署环境读取。
                      </p>
                    </div>
                  ) : null}

                  {form.channel === "APP" || form.channel === "BOTH" ? (
                    <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="CorpID">
                          <Input
                            value={form.appCorpId}
                            onChange={(event) => patchForm({ appCorpId: event.target.value })}
                          />
                        </Field>
                        <Field label="AgentID（数字）">
                          <Input
                            value={form.appAgentId}
                            onChange={(event) => patchForm({ appAgentId: event.target.value })}
                          />
                        </Field>
                        <Field label="Secret 环境变量名">
                          <Input
                            value={form.appSecretEnvKey}
                            onChange={(event) =>
                              patchForm({ appSecretEnvKey: event.target.value })
                            }
                          />
                        </Field>
                        <Field label="接收人（成员账号）">
                          <Input
                            value={form.toUser}
                            placeholder="userid，多个用 | 分隔"
                            onChange={(event) => patchForm({ toUser: event.target.value })}
                          />
                        </Field>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        企业应用私聊需在企业微信后台创建自建应用，并把该成员加入应用可见范围；
                        接收人填写成员账号（userid），Secret 只保存环境变量名。
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <span className="text-[11px] text-slate-400">
                      保存后按新配置重新计算下次执行时间
                    </span>
                    <div className="flex gap-2">
                      <Button disabled={updateConfig.isPending} onClick={saveConfig}>
                        {updateConfig.isPending ? "保存中…" : "保存配置"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={testNotify.isPending}
                        onClick={() => testNotify.mutate()}
                      >
                        {testNotify.isPending ? "发送中…" : "测试通知"}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </QueryState>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>手动执行</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-slate-500">
              手动执行会覆盖全部启用关系，默认期间为前一天；可用于补跑指定区间。
            </p>
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              执行时直连源库读取，无需预先导入或同步；源库在期间内无数据时标记为「源库期间内无数据」。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="期间起">
                <DatePicker
                  ariaLabel="期间起"
                  value={periodStart}
                  onChange={setPeriodStart}
                />
              </Field>
              <Field label="期间止">
                <DatePicker
                  ariaLabel="期间止"
                  align="right"
                  value={periodEnd}
                  onChange={setPeriodEnd}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
              />
              执行完成后发送通知
            </label>
            <Button
              disabled={runNow.isPending || config?.inFlight === true}
              onClick={submitRun}
            >
              {runNow.isPending
                ? "提交中…"
                : config?.inFlight === true
                  ? "有任务执行中"
                  : "立即执行"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>执行记录</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryState isLoading={runsQuery.isLoading} error={runsQuery.error}>
            <Table>
              <thead>
                <tr>
                  <Th>创建时间</Th>
                  <Th>期间</Th>
                  <Th>触发</Th>
                  <Th>状态</Th>
                  <Th>关系（执行/无数据/失败）</Th>
                  <Th>批次（成功/失败/复用）</Th>
                  <Th>指标（未通过）</Th>
                  <Th>差异</Th>
                  <Th>通知</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <EmptyRow colSpan={10}>暂无自动对账执行记录</EmptyRow>
                ) : (
                  runs.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <Td className="whitespace-nowrap text-xs">
                        {formatDate(row.createdAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {row.periodStartDate === row.periodEndDate
                          ? row.periodStartDate
                          : `${row.periodStartDate} ~ ${row.periodEndDate}`}
                      </Td>
                      <Td className="text-xs">
                        {labelOf(AUTOMATION_TRIGGER_LABELS, row.triggerType)}
                      </Td>
                      <Td>
                        <Badge tone={statusTone(row.runStatus)}>
                          {labelOf(AUTOMATION_RUN_STATUS_LABELS, row.runStatus)}
                        </Badge>
                      </Td>
                      <Td className="text-xs">
                        {row.pairExecutedCount} / {row.pairNoDataCount} /{" "}
                        {row.pairFailedCount}
                      </Td>
                      <Td className="text-xs">
                        {row.batchSucceededCount} / {row.batchFailedCount} /{" "}
                        {row.batchReusedCount}
                      </Td>
                      <Td className="text-xs">
                        {row.metricTotal}（{row.failMetricCount}）
                      </Td>
                      <Td className="text-xs">{row.diffCount}</Td>
                      <Td>
                        <Badge tone={statusTone(row.notifyStatus)}>
                          {labelOf(AUTOMATION_NOTIFY_STATUS_LABELS, row.notifyStatus)}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedId(selectedId === row.id ? null : row.id)
                            }
                          >
                            {selectedId === row.id ? "收起" : "查看"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:bg-red-50"
                            disabled={isRunningStatus(row.runStatus)}
                            title={
                              isRunningStatus(row.runStatus)
                                ? "执行中的记录不能删除"
                                : undefined
                            }
                            onClick={() => setDeletingId(row.id)}
                          >
                            删除
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      {selectedId === null ? null : (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>执行详情</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <QueryState isLoading={detailQuery.isLoading} error={detailQuery.error}>
              {detail === undefined ? null : (
                <>
                  <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                    <div>
                      <span className="text-slate-400">业务日：</span>
                      {detail.businessDate}
                    </div>
                    <div>
                      <span className="text-slate-400">开始：</span>
                      {formatDate(detail.startedAt)}
                    </div>
                    <div>
                      <span className="text-slate-400">结束：</span>
                      {formatDate(detail.finishedAt)}
                    </div>
                  </div>

                  {detail.errorMessage === null ? null : (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {detail.errorMessage}
                    </div>
                  )}
                  {detail.notifyError === null ? null : (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      通知未完全发送：{detail.notifyError}
                    </div>
                  )}

                  {summary === null ? null : (
                    <>
                      {summary.pairCount > 0 && summary.pairExecutedCount === 0 ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                          本次没有执行任何对账关系：源库在所选期间内没有数据，或源库读取失败。
                          请检查环境、系统 schema 配置及源库数据。
                        </div>
                      ) : null}
                      <div>
                        <div className="mb-2 text-xs font-medium text-slate-600">
                          对账关系明细
                        </div>
                        <Table>
                          <thead>
                            <tr>
                              <Th>对账关系</Th>
                              <Th>状态</Th>
                              <Th>批次（新建/复用/失败）</Th>
                              <Th>指标（未通过）</Th>
                              <Th>差异</Th>
                              <Th>说明</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.pairs.length === 0 ? (
                              <EmptyRow colSpan={6}>本次没有启用的对账关系</EmptyRow>
                            ) : (
                              summary.pairs.map((pair) => (
                                <tr key={pair.pairId}>
                                  <Td className="text-xs">{pair.pairName}</Td>
                                  <Td>
                                    <Badge
                                      tone={
                                        pair.status === "SUCCEEDED"
                                          ? "success"
                                          : pair.status === "FAILED"
                                            ? "danger"
                                            : "warning"
                                      }
                                    >
                                      {labelOf(AUTOMATION_PAIR_STATUS_LABELS, pair.status)}
                                    </Badge>
                                  </Td>
                                  <Td className="text-xs">
                                    {pair.createdCount} / {pair.reusedCount} /{" "}
                                    {pair.failedPacks.length +
                                      pair.runs.filter(
                                        (run) => run.runStatus === "FAILED"
                                      ).length}
                                  </Td>
                                  <Td className="text-xs">
                                    {pair.metricTotal}（{pair.failMetricCount}）
                                  </Td>
                                  <Td className="text-xs">{pair.diffCount}</Td>
                                  <Td className="text-xs text-slate-500">
                                    {pair.failedPacks.length > 0
                                      ? pair.failedPacks
                                          .map(
                                            (pack) =>
                                              `${pack.packCode}：${pack.message}`
                                          )
                                          .join("；")
                                      : pair.skippedPacks.length > 0
                                        ? pair.skippedPacks
                                            .map((pack) => pack.packCode)
                                            .join("、") + " 源库期间内无数据"
                                        : "-"}
                                  </Td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </Table>
                      </div>

                      {summary.failedMetrics.length === 0 ? null : (
                        <div>
                          <div className="mb-2 text-xs font-medium text-slate-600">
                            未通过指标（前 20）
                          </div>
                          <Table>
                            <thead>
                              <tr>
                                <Th>指标包</Th>
                                <Th>指标</Th>
                                <Th>失败条数</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.failedMetrics.map((metric) => {
                                const key = `${metric.runId}:${metric.metricCode}`;
                                const expanded = expandedMetric === key;
                                return (
                                  <Fragment key={key}>
                                    <tr>
                                      <Td className="text-xs">{metric.packName}</Td>
                                      <Td className="text-xs">{metric.metricName}</Td>
                                      <Td className="text-xs">
                                        <div className="flex items-center gap-2">
                                          <span>{metric.failCount}</span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                              setExpandedMetric(expanded ? null : key)
                                            }
                                          >
                                            {expanded ? "收起" : "查看明细"}
                                          </Button>
                                        </div>
                                      </Td>
                                    </tr>
                                    {expanded ? (
                                      <tr>
                                        <Td colSpan={3} className="bg-slate-50">
                                          <FailedMetricDiffs
                                            runId={metric.runId}
                                            metricCode={metric.metricCode}
                                          />
                                        </Td>
                                      </tr>
                                    ) : null}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </Table>
                        </div>
                      )}
                    </>
                  )}

                  {detail.messageText === null ? null : (
                    <div>
                      <div className="mb-2 text-xs font-medium text-slate-600">
                        已生成的通知内容
                      </div>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        {detail.messageText}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </QueryState>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingId(null);
          }
        }}
        title="删除自动对账记录"
        description="删除后该条执行记录不再出现在列表中；已生成的对账批次、指标结果和差异仍保留，可在报表与差异页面查看。"
        confirmLabel="删除记录"
        tone="danger"
        busy={deleteRun.isPending}
        onConfirm={() => {
          if (deletingId !== null) {
            deleteRun.mutate({ id: deletingId });
          }
        }}
      />
    </div>
  );
}
