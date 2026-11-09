import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DiffDrawer } from "../components/DiffDrawer";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { ResultBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { friendlyError } from "../lib/errors";
import { formatMoney } from "../lib/format";
import {
  DIFF_STATUS_LABELS,
  METRIC_TYPE_LABELS,
  diffTypeLabel,
  labelOf
} from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const toast = useToast();
  const { isAdvanced } = useScope();
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"cancel" | "replay" | null>(null);

  const summary = trpc.run.summary.useQuery(
    { id: id ?? "" },
    {
      enabled: id !== undefined,
      refetchInterval: (query) => {
        const status = query.state.data?.run.runStatus;
        return status === "PENDING" || status === "RUNNING" ? 2000 : false;
      }
    }
  );
  const diffs = trpc.run.diffs.useQuery(
    { id: id ?? "", limit: 500 },
    { enabled: id !== undefined }
  );

  const cancelRun = trpc.run.cancel.useMutation({
    onSuccess: async () => {
      setPendingAction(null);
      toast.success("执行已终止。");
      await utils.run.summary.invalidate({ id: id ?? "" });
      await utils.run.list.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const replayRun = trpc.run.replay.useMutation({
    onSuccess: async (result) => {
      setPendingAction(null);
      toast.success("已创建新的执行批次。");
      await utils.run.list.invalidate();
      navigate(`/runs/${result.run.id}`);
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });

  const metrics = summary.data?.metrics ?? [];
  const metricNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const metric of metrics) {
      map.set(metric.metricCode, metric.metricName);
    }
    return map;
  }, [metrics]);
  const visibleDiffs = (diffs.data ?? []).filter(
    (diff) => selectedMetric === null || diff.metricCode === selectedMetric
  );
  const runStatus = summary.data?.run.runStatus;

  if (id === undefined) {
    return <div className="text-sm text-red-600">缺少执行批次 ID</div>;
  }

  return (
    <div>
      <PageHeader
        title="执行结果"
        description="查看本次对账的指标结果与差异明细"
        actions={
          <div className="flex items-center gap-2">
            {runStatus === "PENDING" || runStatus === "RUNNING" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={cancelRun.isPending}
                onClick={() => setPendingAction("cancel")}
              >
                终止执行
              </Button>
            ) : null}
            {runStatus === "SUCCEEDED" ||
            runStatus === "FAILED" ||
            runStatus === "CANCELLED" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={replayRun.isPending}
                onClick={() => setPendingAction("replay")}
              >
                重新执行
              </Button>
            ) : null}
            <Link to="/runs" className="text-sm text-blue-600 hover:underline">
              返回执行记录
            </Link>
          </div>
        }
      />

      <QueryState isLoading={summary.isLoading} error={summary.error}>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-slate-900">{summary.data?.run.runNo}</span>
          <ResultBadge result={summary.data?.run.runStatus} />
          <span className="text-xs text-slate-500">
            {summary.data?.pack.packName}
            {isAdvanced ? `（${summary.data?.pack.packCode}）` : ""} ·{" "}
            {summary.data?.run.periodStartDate} ~ {summary.data?.run.periodEndDate}
          </span>
          {summary.data?.run.failureMessage === null ||
          summary.data?.run.failureMessage === undefined ? null : (
            <span className="text-xs text-red-600">
              {isAdvanced
                ? summary.data.run.failureMessage
                : "本次执行未成功，请重新执行或联系管理员。"}
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="指标总数" value={summary.data?.run.metricTotal ?? 0} />
          <StatCard
            label="未通过指标"
            value={summary.data?.run.failMetricCount ?? 0}
            hint="任一指标不通过会阻断阶段确认"
          />
          <StatCard label="差异指标" value={summary.data?.run.failMetricCount ?? 0} />
          <StatCard label="差异条数" value={(diffs.data ?? []).length} />
        </div>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>指标汇总</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>指标</Th>
                  <Th>类型</Th>
                  <Th>结果</Th>
                  <Th>总数</Th>
                  <Th>未通过</Th>
                </tr>
              </thead>
              <tbody>
                {metrics.length === 0 ? (
                  <EmptyRow colSpan={5}>暂无指标结果</EmptyRow>
                ) : (
                  metrics.map((metric) => (
                    <tr
                      key={`${metric.comparisonCode}-${metric.metricCode}`}
                      className={
                        selectedMetric === metric.metricCode
                          ? "cursor-pointer bg-blue-50"
                          : "cursor-pointer hover:bg-slate-50"
                      }
                      onClick={() =>
                        setSelectedMetric(
                          selectedMetric === metric.metricCode ? null : metric.metricCode
                        )
                      }
                    >
                      <Td>
                        <div>{metric.metricName}</div>
                        {isAdvanced ? (
                          <div className="font-mono text-xs text-slate-400">
                            {metric.metricCode}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-xs text-slate-500">
                        {labelOf(METRIC_TYPE_LABELS, metric.metricType)}
                      </Td>
                      <Td>
                        <ResultBadge result={metric.checkResult} />
                      </Td>
                      <Td>{metric.totalCount}</Td>
                      <Td className={metric.failCount > 0 ? "font-medium text-red-600" : ""}>
                        {metric.failCount}
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>
              差异明细
              {selectedMetric === null
                ? ""
                : ` · ${metricNames.get(selectedMetric) ?? selectedMetric}`}
            </CardTitle>
            {selectedMetric === null ? null : (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => setSelectedMetric(null)}
              >
                清除筛选
              </button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <QueryState isLoading={diffs.isLoading} error={diffs.error}>
              <Table>
                <thead>
                  <tr>
                    <Th>指标</Th>
                    <Th>业务键</Th>
                    {isAdvanced ? <Th>字段</Th> : null}
                    <Th>类型</Th>
                    <Th>左值</Th>
                    <Th>右值</Th>
                    <Th>差异</Th>
                    <Th>状态</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDiffs.length === 0 ? (
                    <EmptyRow colSpan={isAdvanced ? 8 : 7}>该指标无差异</EmptyRow>
                  ) : (
                    visibleDiffs.slice(0, 200).map((diff) => (
                      <tr
                        key={diff.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setSelectedDiffId(diff.id)}
                      >
                        <Td>{metricNames.get(diff.metricCode) ?? diff.metricCode}</Td>
                        <Td className="max-w-[260px] truncate text-xs" title={diff.businessKeyText}>
                          {diff.businessKeyText}
                        </Td>
                        {isAdvanced ? (
                          <Td className="font-mono text-xs">{diff.fieldCode ?? "-"}</Td>
                        ) : null}
                        <Td className="text-xs">{diffTypeLabel(diff.diffType)}</Td>
                        <Td className="text-right font-mono text-xs">
                          {formatMoney(diff.leftValue)}
                        </Td>
                        <Td className="text-right font-mono text-xs">
                          {formatMoney(diff.rightValue)}
                        </Td>
                        <Td className="text-right font-mono text-xs">
                          {formatMoney(diff.diffValue)}
                        </Td>
                        <Td>
                          <ResultBadge
                            result={diff.diffStatus}
                            label={labelOf(DIFF_STATUS_LABELS, diff.diffStatus)}
                          />
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </QueryState>
          </CardContent>
        </Card>
      </QueryState>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction === "cancel" ? "终止执行" : "重新执行"}
        description={
          pendingAction === "cancel"
            ? "终止后本次批次将不再继续计算，是否确认？"
            : "将基于相同期间和指标包创建新的执行批次，原批次记录保留，是否继续？"
        }
        confirmLabel={pendingAction === "cancel" ? "终止执行" : "重新执行"}
        tone={pendingAction === "cancel" ? "danger" : "primary"}
        busy={cancelRun.isPending || replayRun.isPending}
        onConfirm={() => {
          if (pendingAction === "cancel") {
            cancelRun.mutate({ id });
          } else if (pendingAction === "replay") {
            replayRun.mutate({ id });
          }
        }}
      />

      <DiffDrawer diffId={selectedDiffId} onClose={() => setSelectedDiffId(null)} />
    </div>
  );
}
