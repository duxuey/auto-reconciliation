import { useMemo, useState } from "react";
import { DiffDrawer } from "../components/DiffDrawer";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { ResultBadge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, Input, Select } from "../components/ui/input";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { formatDate, formatMoney } from "../lib/format";
import { DIFF_STATUS_LABELS, diffTypeLabel, labelOf } from "../lib/labels";
import { usePageFilters } from "../lib/pageFilters";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

export function DiffsPage() {
  const { pairId, environmentId, period, isAdvanced, searchParams } = usePageFilters();
  const { pair } = useScope();
  const [status, setStatus] = useState(() => searchParams.get("status") ?? "");
  const [metricCode, setMetricCode] = useState("");
  const [businessKey, setBusinessKey] = useState("");
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);

  const report = trpc.report.metrics.useQuery(
    {
      environmentId,
      pairId,
      ...period
    },
    { enabled: pairId !== undefined }
  );
  const metricNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of report.data ?? []) {
      if (!map.has(row.metricCode)) {
        map.set(row.metricCode, row.metricName);
      }
    }
    return map;
  }, [report.data]);
  const metricOptions = [...metricNames.entries()];

  const diffs = trpc.diff.list.useQuery(
    {
      limit: 200,
      pairId,
      environmentId,
      ...period,
      ...(status === "" ? {} : { status }),
      ...(metricCode === "" ? {} : { metricCode }),
      ...(businessKey === "" ? {} : { businessKey })
    },
    { enabled: pairId !== undefined }
  );

  return (
    <div>
      <PageHeader
        title="差异处理"
        description={`${pair?.pairName ?? "当前对账关系"} · ${period.periodStartDate} 至 ${period.periodEndDate}；点击差异查看来源记录并处理`}
      />

      <Card className="mb-4">
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="处理状态">
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">全部</option>
                {Object.entries(DIFF_STATUS_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="指标">
              <Select
                value={metricCode}
                onChange={(event) => setMetricCode(event.target.value)}
              >
                <option value="">全部指标</option>
                {metricOptions.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="业务键">
              <Input
                placeholder="输入保单号或业务键"
                value={businessKey}
                onChange={(event) => setBusinessKey(event.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>差异明细（{(diffs.data ?? []).length}）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryState isLoading={diffs.isLoading} error={diffs.error}>
            <Table>
              <thead>
                <tr>
                  <Th>指标</Th>
                  <Th>业务键</Th>
                  <Th>差异类型</Th>
                  {isAdvanced ? <Th>字段</Th> : null}
                  <Th>左侧值</Th>
                  <Th>右侧值</Th>
                  <Th>差异</Th>
                  <Th>状态</Th>
                  <Th>时间</Th>
                </tr>
              </thead>
              <tbody>
                {(diffs.data ?? []).length === 0 ? (
                  <EmptyRow colSpan={isAdvanced ? 9 : 8}>
                    本期间没有符合条件的差异
                  </EmptyRow>
                ) : (
                  (diffs.data ?? []).map((diff) => (
                    <tr
                      key={diff.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setSelectedDiffId(diff.id)}
                    >
                      <Td>
                        <div>{metricNames.get(diff.metricCode) ?? diff.metricCode}</div>
                        {isAdvanced ? (
                          <div className="font-mono text-[11px] text-slate-400">
                            {diff.metricCode}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="max-w-[280px] truncate text-xs" title={diff.businessKeyText}>
                        {diff.businessKeyText}
                      </Td>
                      <Td className="text-xs">{diffTypeLabel(diff.diffType)}</Td>
                      {isAdvanced ? (
                        <Td className="font-mono text-[11px]">{diff.fieldCode ?? "-"}</Td>
                      ) : null}
                      <Td className="text-right font-mono text-xs">{formatMoney(diff.leftValue)}</Td>
                      <Td className="text-right font-mono text-xs">{formatMoney(diff.rightValue)}</Td>
                      <Td className="text-right font-mono text-xs">{formatMoney(diff.diffValue)}</Td>
                      <Td>
                        <ResultBadge
                          result={diff.diffStatus}
                          label={labelOf(DIFF_STATUS_LABELS, diff.diffStatus)}
                        />
                      </Td>
                      <Td className="text-xs text-slate-500">{formatDate(diff.createdAt)}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      <DiffDrawer diffId={selectedDiffId} onClose={() => setSelectedDiffId(null)} />
    </div>
  );
}
