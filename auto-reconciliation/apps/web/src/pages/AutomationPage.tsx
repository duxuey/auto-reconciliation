import { Fragment, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import {
  IconActivity,
  IconAlert,
  IconCheck,
  IconRuns
} from "../components/icons";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard
} from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { DatePicker } from "../components/ui/date-picker";
import { Field } from "../components/ui/input";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { friendlyError } from "../lib/errors";
import { formatDate, formatMoney } from "../lib/format";
import {
  AUTOMATION_NOTIFY_STATUS_LABELS,
  AUTOMATION_PAIR_STATUS_LABELS,
  AUTOMATION_RUN_STATUS_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  diffTypeLabel,
  labelOf,
  statusTone
} from "../lib/labels";
import { trpc } from "../lib/trpc";

interface SummaryPairView {
  pairId: string;
  pairCode: string;
  pairName: string;
  status: string;
  metricTotal: number;
  failMetricCount: number;
  diffCount: number;
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
          <div className="mb-1 text-xs text-slate-500">
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
                    className="max-w-[260px] truncate font-mono text-xs"
                    title={diff.businessKeyText}
                  >
                    {diff.businessKeyText}
                  </Td>
                  <Td className="text-xs">{diffTypeLabel(diff.diffType)}</Td>
                  <Td className="font-mono text-xs">{diff.fieldCode ?? "-"}</Td>
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
  const overviewQuery = trpc.automation.overview.useQuery(undefined, {
    refetchInterval: (query) => {
      const data = query.state.data;
      const running =
        data?.inFlight === true ||
        (data?.latestRun !== null &&
          data?.latestRun !== undefined &&
          isRunningStatus(data.latestRun.runStatus));
      return running ? 3000 : false;
    }
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

  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [notify, setNotify] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

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

  const runNow = trpc.automation.runNow.useMutation({
    onSuccess: async (result) => {
      toast.success("已提交执行，可在下方执行记录查看进度。");
      setSelectedId(result.automationRunId);
      await utils.automation.listRuns.invalidate();
      await utils.automation.overview.invalidate();
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
      await utils.automation.overview.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, true))
  });

  const overview = overviewQuery.data;
  const latestRun = overview?.latestRun ?? null;
  const periodStart = period?.start ?? overview?.defaultPeriodStartDate ?? "";
  const periodEnd = period?.end ?? overview?.defaultPeriodEndDate ?? "";
  const runs = runsQuery.data ?? [];
  const detail = detailQuery.data;
  const summary = (detail?.summaryExt ?? null) as unknown as SummaryView | null;

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

  const latestPeriod =
    latestRun === null
      ? null
      : latestRun.periodStartDate === latestRun.periodEndDate
        ? latestRun.periodStartDate
        : `${latestRun.periodStartDate} ~ ${latestRun.periodEndDate}`;

  return (
    <div>
      <PageHeader
        title="自动对账"
        description="按设定时间自动执行全部启用关系的对账，也可手动补跑指定期间；执行结果与通知状态可在下方查看。"
      />

      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="已配置指标"
          value={overview === undefined ? "-" : overview.configuredMetricCount}
          hint={
            overview === undefined ? undefined : `${overview.configuredPackCount} 个指标包`
          }
          tone="blue"
          icon={<IconActivity className="h-5 w-5" />}
        />
        <StatCard
          label="最近执行指标"
          value={latestRun === null ? "-" : latestRun.metricTotal}
          hint={
            latestRun === null
              ? "尚未执行"
              : `${latestPeriod} · 执行关系 ${latestRun.pairExecutedCount}/${latestRun.pairCount}`
          }
          tone="indigo"
          icon={<IconRuns className="h-5 w-5" />}
        />
        <StatCard
          label="最近通过指标"
          value={latestRun === null ? "-" : latestRun.passedMetricCount}
          hint={latestRun === null ? "尚未执行" : "最近一次自动对账"}
          tone="emerald"
          icon={<IconCheck className="h-5 w-5" />}
        />
        <StatCard
          label="最近未通过指标"
          value={latestRun === null ? "-" : latestRun.failMetricCount}
          hint={
            latestRun === null
              ? "尚未执行"
              : latestRun.runStatus === "FAILED"
                ? "最近一次执行失败"
                : latestRun.failMetricCount > 0
                  ? "需在责任系统核查"
                  : "全部指标通过"
          }
          tone={
            latestRun === null
              ? "amber"
              : latestRun.runStatus === "FAILED" || latestRun.failMetricCount > 0
                ? "red"
                : "emerald"
          }
          icon={
            latestRun !== null &&
            latestRun.runStatus !== "FAILED" &&
            latestRun.failMetricCount === 0 ? (
              <IconCheck className="h-5 w-5" />
            ) : (
              <IconAlert className="h-5 w-5" />
            )
          }
        />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>手动执行</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">
            手动执行会覆盖全部启用关系，默认期间为前一天；可用于补跑指定区间。执行时直连源库读取，无需预先导入或同步。
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Field label="期间起">
                <DatePicker
                  ariaLabel="期间起"
                  value={periodStart}
                  onChange={(value) =>
                    setPeriod({ start: value, end: periodEnd })
                  }
                />
              </Field>
            </div>
            <div className="w-44">
              <Field label="期间止">
                <DatePicker
                  ariaLabel="期间止"
                  align="right"
                  value={periodEnd}
                  onChange={(value) => setPeriod({ start: periodStart, end: value })}
                />
              </Field>
            </div>
            <label className="flex h-10 items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
              />
              执行完成后发送通知
            </label>
            <Button
              disabled={runNow.isPending || overview?.inFlight === true}
              onClick={submitRun}
            >
              {runNow.isPending
                ? "提交中…"
                : overview?.inFlight === true
                  ? "有任务执行中"
                  : "立即执行"}
            </Button>
          </div>
        </CardContent>
      </Card>

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
                  <Th>执行方式</Th>
                  <Th>状态</Th>
                  <Th>指标（通过 / 总数）</Th>
                  <Th>差异条数</Th>
                  <Th>通知</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <EmptyRow colSpan={8}>暂无自动对账执行记录</EmptyRow>
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
                        <span
                          className={
                            row.failMetricCount > 0
                              ? "font-medium text-red-600"
                              : "font-medium text-emerald-600"
                          }
                        >
                          {Math.max(0, row.metricTotal - row.failMetricCount)}
                        </span>
                        <span className="text-slate-400"> / {row.metricTotal}</span>
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
                              <Th>指标（通过 / 总数）</Th>
                              <Th>差异条数</Th>
                              <Th>说明</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.pairs.length === 0 ? (
                              <EmptyRow colSpan={5}>本次没有启用的对账关系</EmptyRow>
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
                                    {Math.max(0, pair.metricTotal - pair.failMetricCount)}
                                    <span className="text-slate-400">
                                      {" "}
                                      / {pair.metricTotal}
                                    </span>
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
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
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
        description="删除后该条执行记录不再出现在列表中；已生成的对账批次、指标结果和差异仍保留，可在对账报表与执行详情中查看。"
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
