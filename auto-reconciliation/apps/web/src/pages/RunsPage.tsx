import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { ResultBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, Input, Select } from "../components/ui/input";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { friendlyError } from "../lib/errors";
import { formatDate } from "../lib/format";
import { RUN_MODE_LABELS } from "../lib/labels";
import { usePageFilters } from "../lib/pageFilters";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

export function RunsPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const toast = useToast();
  const { pairId, environmentId, period, isAdvanced } = usePageFilters();
  const { pair } = useScope();
  const packs = trpc.pack.list.useQuery({ pairId }, { enabled: isAdvanced });
  const runs = trpc.run.list.useQuery(
    {
      limit: 50,
      environmentId,
      pairId,
      ...period
    },
    { enabled: pairId !== undefined }
  );
  const [packId, setPackId] = useState("");
  const [startDate, setStartDate] = useState(period.periodStartDate);
  const [endDate, setEndDate] = useState(period.periodEndDate);
  const [runMode, setRunMode] = useState<"FULL" | "DRY_RUN">("FULL");

  useEffect(() => {
    setStartDate(period.periodStartDate);
    setEndDate(period.periodEndDate);
  }, [period.periodStartDate, period.periodEndDate]);

  useEffect(() => {
    if (packs.data === undefined) {
      return;
    }
    const stillAvailable = packs.data.some((pack) => pack.id === packId);
    if (!stillAvailable) {
      setPackId(packs.data[0]?.id ?? "");
    }
  }, [packs.data, packId]);

  const createRun = trpc.run.create.useMutation({
    onSuccess: async (result) => {
      toast.success("执行批次已创建。");
      await utils.run.list.invalidate();
      await utils.report.overview.invalidate();
      navigate(`/runs/${result.run.id}`);
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });

  return (
    <div>
      <PageHeader
        title="执行记录"
        description={`${pair?.pairName ?? "当前对账关系"} · ${period.periodStartDate} 至 ${period.periodEndDate}；查看历次对账批次与结果`}
      />

      {isAdvanced ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>手动补跑单个指标包</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="指标包">
                <Select value={packId} onChange={(event) => setPackId(event.target.value)}>
                  <option value="">请选择</option>
                  {(packs.data ?? []).map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.packName}（{pack.packCode}）
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="期间起">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
              <Field label="期间止">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </Field>
              <Field label="执行模式">
                <Select
                  value={runMode}
                  onChange={(event) => setRunMode(event.target.value as "FULL" | "DRY_RUN")}
                >
                  <option value="FULL">{RUN_MODE_LABELS.FULL}</option>
                  <option value="DRY_RUN">{RUN_MODE_LABELS.DRY_RUN}</option>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={packId === "" || createRun.isPending}
                  onClick={() =>
                    createRun.mutate({
                      packId,
                      environmentId,
                      periodStartDate: startDate,
                      periodEndDate: endDate,
                      runMode
                    })
                  }
                >
                  {createRun.isPending ? "创建中…" : "创建并执行"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>执行批次</CardTitle>
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
                  <Th>创建时间</Th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).length === 0 ? (
                  <EmptyRow colSpan={7}>本期间暂无执行批次</EmptyRow>
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
                        {formatDate(item.run.createdAt)}
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
