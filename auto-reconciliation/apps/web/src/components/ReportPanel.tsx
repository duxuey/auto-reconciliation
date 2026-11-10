import { useMemo } from "react";
import { AgingBars } from "./AgingBars";
import { QueryState } from "./QueryState";
import { ResultBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyRow, Table, Td, Th } from "./ui/table";
import { useToast } from "./ui/toast";
import { METRIC_RESULT_LABELS, labelOf } from "../lib/labels";
import type { DatePeriod } from "../lib/period";
import { trpc } from "../lib/trpc";

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function ReportPanel({
  pairId,
  environmentId,
  period,
  isAdvanced
}: {
  pairId: string;
  environmentId: string | undefined;
  period: DatePeriod;
  isAdvanced: boolean;
}) {
  const toast = useToast();
  const { periodStartDate, periodEndDate } = period;

  const packs = trpc.pack.list.useQuery({ pairId });
  const packNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const pack of packs.data ?? []) {
      map.set(pack.packCode, pack.packName);
    }
    return map;
  }, [packs.data]);

  const metrics = trpc.report.metrics.useQuery({
    environmentId,
    pairId,
    periodStartDate,
    periodEndDate
  });
  const aging = trpc.report.aging.useQuery({ environmentId, pairId });

  function exportCsv(): void {
    const rows = metrics.data ?? [];
    if (rows.length === 0) {
      toast.info("当前期间没有可导出的指标结果。");
      return;
    }
    const header = ["指标包", "批次", "指标", "名称", "结果", "总数", "失败"];
    const body = rows.map((row) => [
      packNames.get(row.packCode) ?? row.packCode,
      row.runNo,
      row.metricCode,
      row.metricName,
      labelOf(METRIC_RESULT_LABELS, row.checkResult),
      row.totalCount,
      row.failCount
    ]);
    const csv = [header, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `对账报表_${periodStartDate}_${periodEndDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("报表已导出。");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          期间 {periodStartDate} 至 {periodEndDate}；指标结果与差异账龄可导出 CSV 留档。
        </p>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          导出报表 CSV
        </Button>
      </div>

      <div className="grid gap-4 min-[1400px]:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white min-[1400px]:col-span-2">
          <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-800">指标结果</h3>
          </div>
          <QueryState isLoading={metrics.isLoading} error={metrics.error}>
            <Table>
              <thead>
                <tr>
                  <Th>指标包</Th>
                  <Th>批次</Th>
                  <Th>指标</Th>
                  {isAdvanced ? <Th>指标代码</Th> : null}
                  <Th>结果</Th>
                  <Th>总数</Th>
                  <Th>失败</Th>
                </tr>
              </thead>
              <tbody>
                {(metrics.data ?? []).length === 0 ? (
                  <EmptyRow colSpan={isAdvanced ? 7 : 6}>本期间暂无指标结果</EmptyRow>
                ) : (
                  (metrics.data ?? []).map((row) => (
                    <tr key={`${row.runId}-${row.metricCode}`}>
                      <Td>{packNames.get(row.packCode) ?? row.packCode}</Td>
                      <Td className="text-xs">{row.runNo}</Td>
                      <Td>{row.metricName}</Td>
                      {isAdvanced ? (
                        <Td className="font-mono text-xs">{row.metricCode}</Td>
                      ) : null}
                      <Td>
                        <ResultBadge
                          result={row.checkResult}
                          label={labelOf(METRIC_RESULT_LABELS, row.checkResult)}
                        />
                      </Td>
                      <Td>{row.totalCount}</Td>
                      <Td className={row.failCount > 0 ? "text-red-600" : ""}>
                        {row.failCount}
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </QueryState>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">差异账龄</h3>
          <QueryState isLoading={aging.isLoading} error={aging.error}>
            <AgingBars buckets={aging.data?.buckets ?? []} total={aging.data?.total} />
          </QueryState>
        </div>
      </div>
    </div>
  );
}
