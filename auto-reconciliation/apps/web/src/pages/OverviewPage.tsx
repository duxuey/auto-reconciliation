import { Link } from "react-router-dom";
import { AgingBars } from "../components/AgingBars";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import {
  IconActivity,
  IconAlert,
  IconDiff,
  IconPack
} from "../components/icons";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "../components/ui/card";
import { Table, Td, Th, EmptyRow } from "../components/ui/table";
import { formatCount, formatDate } from "../lib/format";
import { CHECK_STAGE_LABELS, RUN_STATUS_LABELS, labelOf } from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

function packHealth(
  latestRun: { runStatus: string; failMetricCount: number } | null
): { tone: "success" | "danger" | "info" | "neutral"; label: string } {
  if (latestRun === null) {
    return { tone: "neutral", label: "未执行" };
  }
  if (latestRun.runStatus === "PENDING" || latestRun.runStatus === "RUNNING") {
    return { tone: "info", label: labelOf(RUN_STATUS_LABELS, latestRun.runStatus) };
  }
  if (
    latestRun.runStatus === "FAILED" ||
    latestRun.runStatus === "CANCELLED"
  ) {
    return { tone: "danger", label: labelOf(RUN_STATUS_LABELS, latestRun.runStatus) };
  }
  if (latestRun.failMetricCount > 0) {
    return { tone: "danger", label: `未通过 ${latestRun.failMetricCount} 项` };
  }
  return { tone: "success", label: "全部通过" };
}

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
  // 账龄档位依次为 0-3 天、4-7 天、8-30 天、31 天以上，第三档起视为超期。
  const overdueDiffs = (aging.data?.buckets ?? [])
    .slice(2)
    .reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <div>
      <PageHeader
        title="对账总览"
        description={`${environment?.envName ?? "未选择环境"} · ${pair?.pairName ?? "未选择对账关系"}；查看各指标包最近一次执行结果与差异风险，执行明细请到执行记录查看`}
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
          label="最近未通过指标"
          value={formatCount(totalFailMetrics)}
          hint="各包最近一次执行汇总"
          tone="red"
          icon={<IconAlert className="h-5 w-5" />}
        />
        <StatCard
          label="待处理差异"
          value={formatCount(totalOpenDiffs)}
          hint="待处理 / 已指派 / 处理中"
          tone="amber"
          icon={<IconDiff className="h-5 w-5" />}
        />
        <StatCard
          label="超期差异"
          value={formatCount(overdueDiffs)}
          hint="积压超过 7 天"
          tone="violet"
          icon={<IconActivity className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>指标包健康状态</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <QueryState isLoading={overview.isLoading} error={overview.error}>
              <Table>
                <thead>
                  <tr>
                    <Th>指标包</Th>
                    <Th>阶段</Th>
                    <Th>最近执行结果</Th>
                    <Th>最近执行时间</Th>
                    <Th>未处理差异</Th>
                    <Th>操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {packs.length === 0 ? (
                    <EmptyRow colSpan={6}>该对账关系暂未配置指标包</EmptyRow>
                  ) : (
                    packs.map((pack) => {
                      const health = packHealth(pack.latestRun);
                      return (
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
                            <Badge tone={health.tone}>{health.label}</Badge>
                          </Td>
                          <Td className="text-xs text-slate-500">
                            {pack.latestRun === null
                              ? "-"
                              : formatDate(pack.latestRun.createdAt)}
                          </Td>
                          <Td
                            className={
                              pack.openDiffCount > 0
                                ? "font-medium text-amber-600"
                                : ""
                            }
                          >
                            {pack.openDiffCount}
                          </Td>
                          <Td>
                            {pack.latestRun === null ? (
                              <span className="text-xs text-slate-400">暂无执行</span>
                            ) : (
                              <Link
                                to={`/runs/${pack.latestRun.id}`}
                                className="whitespace-nowrap text-xs font-medium text-blue-600 hover:underline"
                              >
                                查看执行
                              </Link>
                            )}
                          </Td>
                        </tr>
                      );
                    })
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
