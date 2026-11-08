import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { ErrorState } from "../components/ui/error-state";
import { DatePicker } from "../components/ui/date-picker";
import { Input } from "../components/ui/input";
import { SelectMenu } from "../components/ui/select-menu";
import { ResultBadge } from "../components/ui/badge";
import { Table, Td, Th, EmptyRow } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { uploadImport } from "../lib/api";
import { cn } from "../lib/cn";
import { friendlyError } from "../lib/errors";
import { formatCount, formatDate } from "../lib/format";
import {
  DIFF_STATUS_LABELS,
  GATE_STATUS_LABELS,
  READINESS_STATUS_LABELS,
  labelOf
} from "../lib/labels";
import { currentMonthPeriod, periodFromSearch, periodQuery, type DatePeriod } from "../lib/period";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

function StepCard({
  index,
  title,
  description,
  active,
  children
}: {
  index: number;
  title: string;
  description?: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn(active === true ? "border-blue-300 shadow-md" : undefined)}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              active === true ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
            )}
          >
            {index}
          </span>
          <div>
            <CardTitle>{title}</CardTitle>
            {description === undefined ? null : (
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function WorkbenchPage() {
  const {
    pairs,
    pairId,
    setPairId,
    environmentId,
    isAdvanced
  } = useScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState<DatePeriod | undefined>(() =>
    periodFromSearch(window.location.search)
  );

  const urlPairId = searchParams.get("pairId");
  const appliedUrlPair = useRef(false);
  // 仅首次进入时沿用链接中的对账关系，之后以用户在工作台中的选择为准
  useEffect(() => {
    if (appliedUrlPair.current) {
      return;
    }
    appliedUrlPair.current = true;
    if (urlPairId !== null && urlPairId !== pairId) {
      setPairId(urlPairId);
    }
  }, [urlPairId, pairId, setPairId]);

  const latestRun = trpc.run.list.useQuery(
    { pairId, environmentId, limit: 1 },
    { enabled: pairId !== undefined }
  );

  useEffect(() => {
    if (period !== undefined) {
      return;
    }
    // 等待该对账关系的最近执行加载完成，避免先用当前月覆盖历史期间
    if (latestRun.isLoading) {
      return;
    }
    const latest = latestRun.data?.[0]?.run;
    if (latest !== undefined) {
      setPeriod({
        periodStartDate: latest.periodStartDate,
        periodEndDate: latest.periodEndDate
      });
      return;
    }
    if (pairId !== undefined) {
      setPeriod(currentMonthPeriod());
    }
  }, [period, latestRun.data, latestRun.isLoading, pairId]);

  useEffect(() => {
    if (pairId === undefined || period === undefined) {
      return;
    }
    const params = new URLSearchParams();
    params.set("pairId", pairId);
    params.set("periodStartDate", period.periodStartDate);
    params.set("periodEndDate", period.periodEndDate);
    setSearchParams(params, { replace: true });
  }, [pairId, period, setSearchParams]);

  const periodInvalid =
    period !== undefined && period.periodStartDate > period.periodEndDate;

  function selectPair(id: string) {
    if (id === pairId) {
      return;
    }
    setPairId(id);
    setPeriod(undefined);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="对账工作台"
        description="按步骤完成一轮对账：选择关系与期间、确认数据、开始对账、处理差异、阶段确认。"
      />

      <StepCard index={1} title="选择对账关系与期间" active={pairId === undefined || period === undefined}>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block space-y-1.5 md:col-span-2 lg:col-span-1">
            <span className="text-xs font-medium text-slate-600">对账关系</span>
            <SelectMenu
              ariaLabel="对账关系"
              value={pairId ?? ""}
              placeholder="请选择对账关系"
              onChange={(id) => {
                if (id !== "") {
                  selectPair(id);
                }
              }}
              options={pairs.map((item) => ({
                value: item.id,
                label: `${item.pairName}（${item.packCount === 0 ? "待配置指标包" : `${item.packCount} 个指标包`}）`,
                disabled: item.packCount === 0
              }))}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-600">期间开始</span>
            <DatePicker
              ariaLabel="期间开始"
              value={period?.periodStartDate ?? ""}
              onChange={(value) =>
                setPeriod({
                  periodStartDate: value,
                  periodEndDate: period?.periodEndDate ?? value
                })
              }
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-600">期间结束</span>
            <DatePicker
              ariaLabel="期间结束"
              align="right"
              value={period?.periodEndDate ?? ""}
              onChange={(value) =>
                setPeriod({
                  periodStartDate: period?.periodStartDate ?? value,
                  periodEndDate: value
                })
              }
            />
          </label>
        </div>
        {periodInvalid ? (
          <p className="mt-2 text-xs text-red-600">开始日期不能晚于结束日期。</p>
        ) : null}
        {pairId === undefined ? (
          <p className="mt-3 text-xs text-slate-500">请先选择一个对账关系。</p>
        ) : null}
      </StepCard>

      {pairId !== undefined && period !== undefined && !periodInvalid ? (
        <WorkbenchSteps
          key={`${pairId}-${period.periodStartDate}-${period.periodEndDate}`}
          pairId={pairId}
          period={period}
          environmentId={environmentId}
          isAdvanced={isAdvanced}
        />
      ) : null}
    </div>
  );
}

function WorkbenchSteps({
  pairId,
  period,
  environmentId,
  isAdvanced
}: {
  pairId: string;
  period: DatePeriod;
  environmentId: string | undefined;
  isAdvanced: boolean;
}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [uploadDataset, setUploadDataset] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [confirmSignOff, setConfirmSignOff] = useState(false);
  const [errorsDataset, setErrorsDataset] = useState<string | null>(null);

  const readiness = trpc.workbench.readiness.useQuery({
    pairId,
    environmentId,
    ...period
  });
  const runs = trpc.run.list.useQuery(
    { pairId, environmentId, ...period, limit: 50 },
    {
      refetchInterval: (query) => {
        const data = query.state.data ?? [];
        return data.some(
          (item) => item.run.runStatus === "PENDING" || item.run.runStatus === "RUNNING"
        )
          ? 2000
          : false;
      }
    }
  );
  const diffs = trpc.diff.list.useQuery({
    pairId,
    environmentId,
    ...period,
    limit: 500
  });
  const adjustments = trpc.adjustment.list.useQuery({ pairId, environmentId });
  const aging = trpc.report.aging.useQuery({ environmentId, pairId });
  const gate = trpc.gate.get.useQuery(
    { stage: "INTERFACE", environmentId, pairId, ...period },
    { retry: false }
  );
  const batchErrors = trpc.importBatch.errors.useQuery(
    { id: errorsDataset ?? "" },
    { enabled: errorsDataset !== null }
  );

  const createRuns = trpc.run.createForPair.useMutation({
    onSuccess: (result) => {
      setConfirmRun(false);
      const reused = result.created.filter((item) => item.reused).length;
      const noSourceData = result.skipped.filter(
        (item) => item.reason === "NO_SOURCE_DATA"
      ).length;
      if (result.failed.length > 0) {
        toast.error(`部分指标包未执行：${result.failed[0]?.message ?? "源库读取失败"}`);
      } else if (result.created.length === 0 && noSourceData > 0) {
        toast.info("源库在所选期间内没有数据。");
      } else if (result.created.length === 0) {
        toast.info("没有可执行的指标包，请检查数据源配置。");
      } else if (reused === result.created.length) {
        toast.info("该期间源数据未变化，已复用现有对账批次。");
      } else {
        toast.success(`已创建 ${result.created.length} 个对账批次，正在执行。`);
      }
      void utils.workbench.readiness.invalidate();
      void utils.run.list.invalidate();
      void utils.report.overview.invalidate();
      void utils.gate.get.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });

  const signOff = trpc.gate.signOff.useMutation({
    onSuccess: () => {
      setConfirmSignOff(false);
      toast.success("阶段已确认通过。");
      void utils.gate.get.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });

  const runRows = runs.data ?? [];
  const diffRows = diffs.data ?? [];
  const readinessData = readiness.data;
  const canRun = readinessData?.summary.canRun === true && runRows.every(
    (item) => item.run.runStatus !== "RUNNING" && item.run.runStatus !== "PENDING"
  );
  const latestByPack = useMemo(() => {
    const map = new Map<string, (typeof runRows)[number]>();
    for (const row of runRows) {
      if (!map.has(row.run.packId)) {
        map.set(row.run.packId, row);
      }
    }
    return [...map.values()];
  }, [runRows]);

  const diffCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of diffRows) {
      counts[item.diffStatus] = (counts[item.diffStatus] ?? 0) + 1;
    }
    return counts;
  }, [diffRows]);

  const pendingAdjustments = (adjustments.data ?? []).filter(
    (item) => item.adjustmentStatus === "SUBMITTED"
  ).length;

  const totalMetric = latestByPack.reduce((sum, item) => sum + item.run.metricTotal, 0);
  const totalFail = latestByPack.reduce(
    (sum, item) => sum + item.run.failMetricCount,
    0
  );
  const hasActiveRun = runRows.some(
    (item) => item.run.runStatus === "PENDING" || item.run.runStatus === "RUNNING"
  );
  const blockingDatasets = (readinessData?.datasets ?? []).filter(
    (item) => item.blocking
  );
  const blockingDirectCount = blockingDatasets.filter(
    (item) => item.dataSource === "DIRECT"
  ).length;
  const blockingStagingCount = blockingDatasets.length - blockingDirectCount;

  return (
    <>
      <StepCard
        index={2}
        title="数据就绪检查"
        description="执行时将直连源库读取本关系所需数据集；文件数据集仍需上传。"
        active={readinessData?.summary.canRun !== true}
      >
        {readiness.isLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">正在检查数据…</p>
        ) : readiness.error !== null ? (
          <ErrorState
            message={friendlyError(readiness.error, isAdvanced)}
            onRetry={() => void readiness.refetch()}
          />
        ) : readinessData === undefined ? null : readinessData.datasets.length === 0 ? (
          <EmptyState
            title="该对账关系暂未配置指标包"
            description="请联系管理员在高级设置中配置指标包后再进行对账。"
          />
        ) : (
          <>
            <div
              className={cn(
                "mb-3 rounded-md px-3 py-2 text-xs",
                readinessData.summary.blockingDatasetCount === 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              )}
            >
              {blockingDatasets.length === 0
                ? "数据源已配置，开始对账时将直连源库读取。"
                : [
                    blockingDirectCount > 0
                      ? `${blockingDirectCount} 个数据集的源库未配置`
                      : null,
                    blockingStagingCount > 0
                      ? `${blockingStagingCount} 个文件数据集尚未接入`
                      : null
                  ]
                    .filter((item) => item !== null)
                    .join("，") + "，请完成配置或上传后再开始对账。"}
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>数据集</Th>
                  <Th>来源系统</Th>
                  <Th>所需指标包</Th>
                  <Th>读取方式</Th>
                  <Th>上次抽取</Th>
                  <Th>行数</Th>
                  <Th>状态</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {readinessData.datasets.map((item) => (
                  <tr key={item.datasetCode}>
                    <Td>{item.datasetName}</Td>
                    <Td>{item.sourceSystem}</Td>
                    <Td className="text-xs text-slate-500">{item.packNames.join("、")}</Td>
                    <Td className="text-xs text-slate-600">
                      {item.dataSource === "DIRECT" ? "直连源库" : "文件暂存"}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {item.latestBatch === null ? "-" : formatDate(item.latestBatch.createdAt)}
                    </Td>
                    <Td>
                      {item.dataSource === "DIRECT"
                        ? item.latestBatch === null
                          ? "-"
                          : formatCount(item.latestBatch.rowLoaded)
                        : formatCount(item.stagedRows)}
                    </Td>
                    <Td>
                      <ResultBadge
                        result={item.status}
                        label={labelOf(READINESS_STATUS_LABELS, item.status)}
                      />
                      {item.datasourceError === null ? null : (
                        <div className="mt-1 text-xs text-red-600">
                          {item.datasourceError}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {item.transport === "FILE" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setUploadDataset(item.datasetCode)}
                          >
                            上传文件
                          </Button>
                        ) : null}
                        {item.latestBatch !== null && item.latestBatch.rowRejected > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setErrorsDataset(item.latestBatch?.id ?? null)}
                          >
                            查看错误
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </StepCard>

      <StepCard
        index={3}
        title="开始对账"
        description="将直连源库读取期间数据，并为配置就绪的指标包执行对账。"
        active={readinessData?.summary.canRun === true && runRows.length === 0}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs leading-5 text-slate-600">
            将执行 <span className="font-medium text-slate-900">{readinessData?.summary.readyPackCount ?? 0}</span>{" "}
            个指标包，期间 {period.periodStartDate} 至 {period.periodEndDate}
            {readinessData !== undefined && readinessData.skippedPacks.length > 0 ? (
              <span className="ml-2 text-slate-500">
                （跳过 {readinessData.skippedPacks.map((item) => item.packName).join("、")}）
              </span>
            ) : null}
          </div>
          <Button disabled={!canRun || createRuns.isPending} onClick={() => setConfirmRun(true)}>
            {createRuns.isPending ? "正在创建…" : "开始对账"}
          </Button>
        </div>
        {readinessData?.summary.canRun === false ? (
          <p className="mt-2 text-xs text-amber-600">
            数据源或文件数据尚未就绪，完成上方准备后即可开始对账。
          </p>
        ) : null}
      </StepCard>

      <StepCard
        index={4}
        title="执行进度与结果"
        description="执行期间页面会自动刷新；完成后可进入差异处理。"
        active={hasActiveRun}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <StatCard label="指标包" value={formatCount(latestByPack.length)} />
          <StatCard label="指标总数" value={formatCount(totalMetric)} />
          <StatCard
            label="未通过指标"
            value={
              <span className={totalFail > 0 ? "text-red-600" : "text-emerald-600"}>
                {formatCount(totalFail)}
              </span>
            }
          />
          <StatCard label="差异条数" value={formatCount(diffRows.length)} />
        </div>
        {runRows.length === 0 ? (
          <EmptyState title="本期间还没有执行记录" description="点击上方「开始对账」创建批次。" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>指标包</Th>
                <Th>状态</Th>
                <Th>指标数</Th>
                <Th>未通过</Th>
                <Th>完成时间</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {latestByPack.map((row) => (
                <tr key={row.run.id}>
                  <Td>{row.packName}</Td>
                  <Td>
                    <ResultBadge result={row.run.runStatus} />
                  </Td>
                  <Td>{formatCount(row.run.metricTotal)}</Td>
                  <Td className={row.run.failMetricCount > 0 ? "text-red-600" : undefined}>
                    {formatCount(row.run.failMetricCount)}
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {formatDate(row.run.finishedAt ?? row.run.createdAt)}
                  </Td>
                  <Td>
                    <Link className="text-blue-600 hover:underline" to={`/runs/${row.run.id}`}>
                      查看结果
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </StepCard>

      <StepCard
        index={5}
        title="处理差异"
        description="处理差异不会直接记账；调整建议需提交并审批后导出给责任系统。"
        active={diffRows.length > 0}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(["OPEN", "ASSIGNED", "INVESTIGATING", "RESOLVED", "WRITTEN_OFF"] as const).map(
            (status) => (
              <StatCard
                key={status}
                label={labelOf(DIFF_STATUS_LABELS, status)}
                value={formatCount(diffCounts[status] ?? 0)}
              />
            )
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>待审批调整建议：{formatCount(pendingAdjustments)}</span>
          <span>待处理差异账龄合计：{formatCount(aging.data?.total ?? 0)}</span>
          <Link
            className="text-blue-600 hover:underline"
            to={`/diffs?pairId=${pairId}&${periodQuery(period)}&status=OPEN`}
          >
            进入差异处理
          </Link>
          <Link
            className="text-blue-600 hover:underline"
            to={`/adjustments?pairId=${pairId}&${periodQuery(period)}`}
          >
            查看调整建议
          </Link>
        </div>
      </StepCard>

      <StepCard
        index={6}
        title="阶段确认与报表"
        description="所有指标通过后可确认阶段；报表可导出给业务留档。"
        active={gate.data?.gateStatus === "PASSED"}
      >
        {gate.isLoading ? (
          <p className="py-4 text-sm text-slate-400">正在读取阶段状态…</p>
        ) : gate.data === undefined ? (
          <EmptyState
            title="尚未生成阶段结果"
            description="请先完成本期间对账，系统会自动生成阶段状态。"
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <ResultBadge
                result={gate.data.gateStatus}
                label={labelOf(GATE_STATUS_LABELS, gate.data.gateStatus)}
              />
              <span className="text-xs text-slate-500">
                {gate.data.signedOffBy === null
                  ? "尚未签核"
                  : `签核人：${gate.data.signedOffBy} · ${formatDate(gate.data.signedOffAt)}`}
              </span>
              <Button
                size="sm"
                disabled={gate.data.gateStatus !== "PASSED" || signOff.isPending}
                onClick={() => setConfirmSignOff(true)}
              >
                确认阶段通过
              </Button>
            </div>
            {gate.data.blockingMetrics.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-slate-600">阻断指标</div>
                <Table>
                  <thead>
                    <tr>
                      <Th>指标包</Th>
                      <Th>指标</Th>
                      <Th>失败数</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {gate.data.blockingMetrics.map((item) => (
                      <tr key={`${item.packCode}-${item.metricCode}`}>
                        <Td>{item.packCode}</Td>
                        <Td>{item.metricName}</Td>
                        <Td>{formatCount(item.failCount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : null}
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            className="text-xs text-blue-600 hover:underline"
            to={`/reports?pairId=${pairId}&${periodQuery(period)}`}
          >
            查看对账报表
          </Link>
          <Link
            className="text-xs text-blue-600 hover:underline"
            to={`/gates?pairId=${pairId}&${periodQuery(period)}`}
          >
            查看阶段详情
          </Link>
        </div>
      </StepCard>

      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title="开始对账"
        description={`将对 ${readinessData?.summary.readyPackCount ?? 0} 个指标包执行 ${period.periodStartDate} 至 ${period.periodEndDate} 的对账，是否继续？`}
        confirmLabel="开始对账"
        busy={createRuns.isPending}
        onConfirm={() =>
          createRuns.mutate({
            pairId,
            environmentId,
            periodStartDate: period.periodStartDate,
            periodEndDate: period.periodEndDate
          })
        }
      />

      <ConfirmDialog
        open={confirmSignOff}
        onOpenChange={setConfirmSignOff}
        title="确认阶段通过"
        description="确认后将写入审计记录，并允许进入后续环节。请确认本期间对账结果已复核。"
        confirmLabel="确认通过"
        busy={signOff.isPending}
        onConfirm={() =>
          signOff.mutate({
            stage: "INTERFACE",
            environmentId,
            pairId,
            periodStartDate: period.periodStartDate,
            periodEndDate: period.periodEndDate,
            dryRun: false,
            confirm: true
          })
        }
      />

      <UploadDatasetDialog
        open={uploadDataset !== null}
        datasetCode={uploadDataset}
        environmentId={environmentId}
        period={period}
        onClose={() => setUploadDataset(null)}
        onDone={() => {
          setUploadDataset(null);
          void utils.workbench.readiness.invalidate();
          void utils.importBatch.list.invalidate();
        }}
      />

      <Dialog open={errorsDataset !== null} onOpenChange={(open) => !open && setErrorsDataset(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>导入错误</DialogTitle>
          </DialogHeader>
          <Table>
            <thead>
              <tr>
                <Th>行号</Th>
                <Th>错误信息</Th>
              </tr>
            </thead>
            <tbody>
              {(batchErrors.data ?? []).length === 0 ? (
                <EmptyRow colSpan={2}>暂无错误行</EmptyRow>
              ) : (
                (batchErrors.data ?? []).map((item) => (
                  <tr key={item.id}>
                    <Td>{item.rowNo}</Td>
                    <Td className="text-xs">{item.errorMessage}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UploadDatasetDialog({
  open,
  datasetCode,
  environmentId,
  period,
  onClose,
  onDone
}: {
  open: boolean;
  datasetCode: string | null;
  environmentId: string | undefined;
  period: DatePeriod;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleUpload() {
    if (file === null || datasetCode === null) {
      return;
    }
    setBusy(true);
    try {
      await uploadImport({
        datasetCode,
        environmentId,
        periodStartDate: period.periodStartDate,
        periodEndDate: period.periodEndDate,
        file
      });
      toast.success("文件已导入。");
      setFile(null);
      onDone();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>上传对账数据</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            支持 CSV / JSON 文件，期间 {period.periodStartDate} 至 {period.periodEndDate}。
          </p>
          <Input
            type="file"
            accept=".csv,.json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={() => void handleUpload()} disabled={file === null || busy}>
              {busy ? "上传中…" : "上传并导入"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
