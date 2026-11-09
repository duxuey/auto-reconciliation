import { useEffect, useMemo, useState } from "react";
import { AgingBars } from "../components/AgingBars";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { ResultBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, Input } from "../components/ui/input";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { METRIC_RESULT_LABELS, labelOf } from "../lib/labels";
import { usePageFilters } from "../lib/pageFilters";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function ReportsPage() {
  const toast = useToast();
  const { pairId, environmentId, period, isAdvanced } = usePageFilters();
  const { pair } = useScope();
  const [periodStartDate, setPeriodStartDate] = useState(period.periodStartDate);
  const [periodEndDate, setPeriodEndDate] = useState(period.periodEndDate);

  useEffect(() => {
    setPeriodStartDate(period.periodStartDate);
    setPeriodEndDate(period.periodEndDate);
  }, [period.periodStartDate, period.periodEndDate]);

  const packs = trpc.pack.list.useQuery({ pairId }, { enabled: pairId !== undefined });
  const packNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const pack of packs.data ?? []) {
      map.set(pack.packCode, pack.packName);
    }
    return map;
  }, [packs.data]);

  const metrics = trpc.report.metrics.useQuery(
    {
      environmentId,
      pairId,
      periodStartDate,
      periodEndDate
    },
    { enabled: pairId !== undefined }
  );
  const aging = trpc.report.aging.useQuery(
    { environmentId, pairId },
    { enabled: pairId !== undefined }
  );

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
    <div>
      <PageHeader
        title="对账报表"
        description={`${pair?.pairName ?? "当前对账关系"}；指标结果与差异账龄，可导出 CSV 留档`}
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv}>
            导出报表 CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-card">
        <Field label="期间起">
          <Input
            type="date"
            value={periodStartDate}
            onChange={(event) => setPeriodStartDate(event.target.value)}
          />
        </Field>
        <Field label="期间止">
          <Input
            type="date"
            value={periodEndDate}
            onChange={(event) => setPeriodEndDate(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>指标结果</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>差异账龄</CardTitle>
          </CardHeader>
          <CardContent>
            <QueryState isLoading={aging.isLoading} error={aging.error}>
              <AgingBars
                buckets={aging.data?.buckets ?? []}
                total={aging.data?.total}
              />
            </QueryState>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
