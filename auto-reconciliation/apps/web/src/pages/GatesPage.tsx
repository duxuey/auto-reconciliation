import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/ui/empty-state";
import { ResultBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { friendlyError } from "../lib/errors";
import { formatDate } from "../lib/format";
import { GATE_STATUS_LABELS, labelOf } from "../lib/labels";
import { usePageFilters } from "../lib/pageFilters";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

export function GatesPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { pairId, environmentId, period, isAdvanced } = usePageFilters();
  const { pair } = useScope();
  const [confirmSignOff, setConfirmSignOff] = useState(false);

  const packs = trpc.pack.list.useQuery({ pairId }, { enabled: pairId !== undefined });
  const packNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const pack of packs.data ?? []) {
      map.set(pack.packCode, pack.packName);
    }
    return map;
  }, [packs.data]);

  const gate = trpc.gate.get.useQuery(
    {
      stage: "INTERFACE",
      periodStartDate: period.periodStartDate,
      periodEndDate: period.periodEndDate,
      environmentId,
      pairId
    },
    { retry: false, refetchInterval: 3000, enabled: pairId !== undefined }
  );
  const signOff = trpc.gate.signOff.useMutation({
    onSuccess: async () => {
      setConfirmSignOff(false);
      toast.success("阶段已确认通过，签核记录已写入。");
      await utils.gate.get.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });

  return (
    <div>
      <PageHeader
        title="阶段确认"
        description={`${pair?.pairName ?? "当前对账关系"} · ${period.periodStartDate} 至 ${period.periodEndDate}；任一指标未通过即阻断，确认通过为 L3 操作`}
      />

      {gate.data === undefined ? (
        <Card>
          <CardContent>
            {gate.isLoading ? (
              <p className="py-10 text-center text-sm text-slate-400">正在读取阶段状态…</p>
            ) : (
              <EmptyState
                title="尚未生成阶段结果"
                description="完成本期间对账后再来查看；系统会在执行完成后自动生成阶段状态。"
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 md:grid-cols-4">
            <StatCard
              label="阶段状态"
              value={
                <ResultBadge
                  result={gate.data.gateStatus}
                  label={labelOf(GATE_STATUS_LABELS, gate.data.gateStatus)}
                />
              }
            />
            <StatCard label="阻断指标" value={gate.data.blockingMetrics.length} />
            <StatCard label="关联批次" value={gate.data.runIds.length} />
            <StatCard
              label="签核"
              value={
                <span className="text-sm font-normal text-slate-600">
                  {gate.data.signedOffBy ?? "未签核"}
                  <span className="mt-1 block text-xs text-slate-400">
                    {formatDate(gate.data.signedOffAt)}
                  </span>
                </span>
              }
            />
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>阻断指标</CardTitle>
              <Button
                disabled={gate.data.gateStatus !== "PASSED" || signOff.isPending}
                onClick={() => setConfirmSignOff(true)}
              >
                {signOff.isPending ? "签核中…" : "确认阶段通过"}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>指标包</Th>
                    <Th>指标</Th>
                    <Th>失败数</Th>
                  </tr>
                </thead>
                <tbody>
                  {gate.data.blockingMetrics.length === 0 ? (
                    <EmptyRow colSpan={3}>全部指标通过</EmptyRow>
                  ) : (
                    gate.data.blockingMetrics.map((metric) => (
                      <tr key={`${metric.packCode}-${metric.metricCode}`}>
                        <Td>
                          <div>{packNames.get(metric.packCode) ?? metric.packCode}</div>
                          {isAdvanced ? (
                            <div className="font-mono text-[11px] text-slate-400">
                              {metric.packCode}
                            </div>
                          ) : null}
                        </Td>
                        <Td>
                          <div>{metric.metricName}</div>
                          {isAdvanced ? (
                            <div className="font-mono text-[11px] text-slate-400">
                              {metric.metricCode}
                            </div>
                          ) : null}
                        </Td>
                        <Td className="text-red-600">{metric.failCount}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </CardContent>
          </Card>

          {isAdvanced ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>关联执行批次</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 text-xs">
                  {gate.data.runIds.map((runId) => (
                    <Link
                      key={runId}
                      to={`/runs/${runId}`}
                      className="rounded bg-slate-100 px-2 py-1 font-mono text-blue-600 hover:bg-slate-200"
                    >
                      {runId}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirmSignOff}
        onOpenChange={setConfirmSignOff}
        title="确认阶段通过"
        description="确认后阶段状态将更新为「已签核」，并写入审计记录。请确认本期间对账结果已复核。"
        confirmLabel="确认通过"
        busy={signOff.isPending}
        onConfirm={() =>
          signOff.mutate({
            stage: "INTERFACE",
            periodStartDate: period.periodStartDate,
            periodEndDate: period.periodEndDate,
            environmentId,
            pairId,
            dryRun: false,
            confirm: true
          })
        }
      />
    </div>
  );
}
