import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { ResultBadge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, Select } from "../components/ui/input";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { formatDate, formatDuration } from "../lib/format";
import { RUN_MODE_LABELS, labelOf } from "../lib/labels";
import { usePageFilters } from "../lib/pageFilters";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

export function RunsPage() {
  const { pairId, environmentId, isAdvanced } = usePageFilters();
  const { pairs, pair, setPairId } = useScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const [packId, setPackId] = useState("");

  const packs = trpc.pack.list.useQuery(
    { pairId },
    { enabled: pairId !== undefined }
  );
  const runs = trpc.run.list.useQuery(
    {
      limit: 50,
      environmentId,
      pairId,
      packId: packId === "" ? undefined : packId
    },
    { enabled: pairId !== undefined }
  );

  function changePair(nextPairId: string): void {
    setPairId(nextPairId);
    setPackId("");
    // 清除地址栏中的关系参数，避免 URL 优先于下拉选择。
    if (searchParams.has("pairId")) {
      const next = new URLSearchParams(searchParams);
      next.delete("pairId");
      setSearchParams(next, { replace: true });
    }
  }

  return (
    <div>
      <PageHeader
        title="执行记录"
        description={`${pair?.pairName ?? "未选择对账关系"}；按对账关系与指标包查看历史执行，点击批次号查看指标结果与差异`}
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <Field label="对账关系">
            <Select
              value={pairId ?? ""}
              onChange={(event) => changePair(event.target.value)}
            >
              {pairs.length === 0 ? <option value="">无对账关系</option> : null}
              {pairs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.pairName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="指标包">
            <Select
              value={packId}
              onChange={(event) => setPackId(event.target.value)}
              disabled={pairId === undefined}
            >
              <option value="">全部指标包</option>
              {(packs.data ?? []).map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {isAdvanced
                    ? `${pack.packName}（${pack.packCode}）`
                    : pack.packName}
                </option>
              ))}
            </Select>
          </Field>
          <div className="text-xs text-slate-500 lg:pb-3">
            {runs.isLoading
              ? "加载中…"
              : `共 ${(runs.data ?? []).length} 条执行记录`}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>执行历史</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryState isLoading={runs.isLoading} error={runs.error}>
            <Table>
              <thead>
                <tr>
                  <Th>批次号</Th>
                  <Th>指标包</Th>
                  <Th>期间</Th>
                  <Th>状态</Th>
                  <Th>指标数</Th>
                  <Th>未通过</Th>
                  <Th>执行时间</Th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).length === 0 ? (
                  <EmptyRow colSpan={7}>
                    {packId === "" ? "暂无执行记录" : "该指标包暂无执行记录"}
                  </EmptyRow>
                ) : (
                  (runs.data ?? []).map((item) => (
                    <tr key={item.run.id} className="hover:bg-slate-50">
                      <Td>
                        <Link
                          to={`/runs/${item.run.id}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {item.run.runNo}
                        </Link>
                        <div className="mt-0.5 text-2xs text-slate-400">
                          {labelOf(RUN_MODE_LABELS, item.run.runMode)}
                        </div>
                      </Td>
                      <Td>
                        <div>{item.packName}</div>
                        {isAdvanced ? (
                          <div className="font-mono text-xs text-slate-400">
                            {item.packCode}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-xs">
                        {item.run.periodStartDate} ~ {item.run.periodEndDate}
                      </Td>
                      <Td>
                        <ResultBadge result={item.run.runStatus} />
                      </Td>
                      <Td>{item.run.metricTotal}</Td>
                      <Td className={item.run.failMetricCount > 0 ? "text-red-600" : ""}>
                        {item.run.failMetricCount}
                      </Td>
                      <Td className="text-xs text-slate-500">
                        <div>
                          {formatDate(item.run.startedAt ?? item.run.createdAt)}
                        </div>
                        <div className="mt-0.5 text-2xs text-slate-400">
                          耗时 {formatDuration(item.run.startedAt, item.run.finishedAt)}
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
    </div>
  );
}
