import { Link } from "react-router-dom";
import { AgingBars } from "../components/AgingBars";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import {
  IconAlert,
  IconDiff,
  IconOverview,
  IconPack
} from "../components/icons";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "../components/ui/card";
import { Table, Td, Th, EmptyRow } from "../components/ui/table";
import { formatCount, formatDate } from "../lib/format";
import { CHECK_STAGE_LABELS, labelOf } from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

export function OverviewPage() {
  const { pairId, pair, environmentId, environment, isAdvanced } = useScope();
  const overview = trpc.report.overview.useQuery({ environmentId, pairId });
  const aging = trpc.report.aging.useQuery({ environmentId, pairId });

  const packs = overview.data?.packs ?? [];
  const totalOpenDiffs = overview.data?.totalOpenDiffs ?? 0;
  const totalFailMetrics = packs.reduce(
    (sum, pack) => sum + (pack.latestRun?.failMetricCount ?? 0),
    0
  );

  return (
    <div>
      <PageHeader
        title="对账总览"
        description={`${environment?.envName ?? "未选择环境"} · ${pair?.pairName ?? "未选择对账关系"}；查看指标包最新执行与差异情况`}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="指标包"
          value={formatCount(packs.length)}
          hint="已启用的对账场景"
          tone="blue"
          icon={<IconPack className="h-5 w-5" />}
        />
        <StatCard
          label="未处理差异"
          value={formatCount(totalOpenDiffs)}
          hint="待处理 / 已指派 / 处理中"
          tone="amber"
          icon={<IconDiff className="h-5 w-5" />}
        />
        <StatCard
          label="最近未通过指标"
          value={formatCount(totalFailMetrics)}
          hint="各包最新一次执行汇总"
          tone="red"
          icon={<IconAlert className="h-5 w-5" />}
        />
        <StatCard
          label="差异账龄"
          value={formatCount(aging.data?.total ?? 0)}
          hint="待处理差异总数"
          tone="violet"
          icon={<IconOverview className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>指标包执行状态</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <QueryState isLoading={overview.isLoading} error={overview.error}>
              <Table>
                <thead>
                  <tr>
                    <Th>指标包</Th>
                    <Th>阶段</Th>
                    <Th>最新批次</Th>
                    <Th>指标数</Th>
                    <Th>未通过</Th>
                    <Th>未处理差异</Th>
                    <Th>时间</Th>
                  </tr>
                </thead>
                <tbody>
                  {packs.length === 0 ? (
                    <EmptyRow colSpan={7}>该对账关系暂未配置指标包</EmptyRow>
                  ) : (
                    packs.map((pack) => (
                      <tr key={pack.packId} className="hover:bg-slate-50">
                        <Td>
                          <div className="font-medium text-slate-900">{pack.packName}</div>
                          {isAdvanced ? (
                            <div className="font-mono text-xs text-slate-400">
                              {pack.packCode}
                            </div>
                          ) : null}
                        </Td>
                        <Td>
                          <Badge tone="neutral">
                            {labelOf(CHECK_STAGE_LABELS, pack.checkStage)}
                          </Badge>
                        </Td>
                        <Td>
                          {pack.latestRun === null ? (
                            <span className="text-xs text-slate-400">未执行</span>
                          ) : (
                            <Link
                              to={`/runs/${pack.latestRun.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {pack.latestRun.runNo}
                            </Link>
                          )}
                        </Td>
                        <Td>{pack.latestRun?.metricTotal ?? "-"}</Td>
                        <Td>
                          {pack.latestRun === null ? (
                            "-"
                          ) : (
                            <span
                              className={
                                pack.latestRun.failMetricCount > 0
                                  ? "font-medium text-red-600"
                                  : "text-emerald-600"
                              }
                            >
                              {pack.latestRun.failMetricCount}
                            </span>
                          )}
                        </Td>
                        <Td>{pack.openDiffCount}</Td>
                        <Td className="text-xs text-slate-500">
                          {pack.latestRun === null ? "-" : formatDate(pack.latestRun.createdAt)}
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
            <CardTitle>差异账龄分布</CardTitle>
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
