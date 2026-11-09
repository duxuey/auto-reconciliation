import { Badge, ResultBadge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { EmptyRow, Table, Td, Th } from "./ui/table";
import { friendlyError } from "../lib/errors";
import { formatDate, formatMoney } from "../lib/format";
import { DIFF_STATUS_LABELS, diffTypeLabel, labelOf } from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

const LOG_ACTION_LABELS: Record<string, string> = {
  ASSIGNED: "指派",
  INVESTIGATING: "开始调查",
  RESOLVED: "解决",
  WRITTEN_OFF: "核销",
  REOPENED: "重开",
  COMMENT: "备注"
};

export function DiffDrawer({
  diffId,
  onClose
}: {
  diffId: string | null;
  onClose: () => void;
}) {
  const { isAdvanced } = useScope();
  const detail = trpc.diff.byId.useQuery(
    { id: diffId ?? "" },
    { enabled: diffId !== null }
  );
  const data = detail.data;

  return (
    <Dialog open={diffId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            差异详情
            {data === undefined ? null : (
              <span className="ml-2 text-xs font-normal text-slate-500">
                {diffTypeLabel(data.diff.diffType)}
                {isAdvanced ? ` · ${data.diff.metricCode}` : ""}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            查看左右值、来源记录与历史处理记录
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
        ) : detail.error !== null ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {friendlyError(detail.error, isAdvanced)}
          </div>
        ) : data === undefined ? null : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ResultBadge
                result={data.diff.diffStatus}
                label={labelOf(DIFF_STATUS_LABELS, data.diff.diffStatus)}
              />
              {isAdvanced ? <Badge tone="neutral">版本 {data.diff.version}</Badge> : null}
              {data.diff.assignee === null ? null : (
                <Badge tone="info">处理人 {data.diff.assignee}</Badge>
              )}
              <span className="text-xs text-slate-500">
                {formatDate(data.diff.createdAt)}
              </span>
            </div>

            <section>
              <h3 className="mb-2 text-xs font-semibold text-slate-700">业务键</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-slate-50 p-3 text-xs">
                {Object.entries(data.diff.businessKeyExt).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="text-slate-500">{key}</span>
                    <span className="font-mono text-slate-800">{value ?? "-"}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold text-slate-700">差异值</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">左侧</div>
                  <div className="mt-1 font-mono text-sm">
                    {formatMoney(data.diff.leftValue)}
                  </div>
                  {data.diff.leftText === null ? null : (
                    <div className="mt-1 text-xs text-slate-500">
                      {data.diff.leftText}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">右侧</div>
                  <div className="mt-1 font-mono text-sm">
                    {formatMoney(data.diff.rightValue)}
                  </div>
                  {data.diff.rightText === null ? null : (
                    <div className="mt-1 text-xs text-slate-500">
                      {data.diff.rightText}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <div className="text-xs text-red-500">差异</div>
                  <div className="mt-1 font-mono text-sm text-red-700">
                    {formatMoney(data.diff.diffValue)}
                  </div>
                  {isAdvanced ? (
                    <div className="mt-1 text-xs text-red-500">
                      字段 {data.diff.fieldCode ?? "-"}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold text-slate-700">来源记录</h3>
              <div className="overflow-hidden rounded-md border border-slate-200">
                <Table>
                  <thead>
                    <tr>
                      {isAdvanced ? <Th>数据集</Th> : null}
                      <Th>记录号</Th>
                      <Th>金额</Th>
                      {isAdvanced ? <Th>属性</Th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.sourceRows.length === 0 ? (
                      <EmptyRow colSpan={isAdvanced ? 4 : 2}>未匹配到来源记录</EmptyRow>
                    ) : (
                      data.sourceRows.map((row) => (
                        <tr key={row.id}>
                          {isAdvanced ? <Td className="text-xs">{row.datasetCode}</Td> : null}
                          <Td className="font-mono text-xs">{row.externalId}</Td>
                          <Td className="font-mono text-xs">
                            {Object.entries(row.amountsExt).map(([field, value]) => (
                              <div key={field}>
                                {isAdvanced ? `${field}: ` : ""}
                                {formatMoney(value)}
                              </div>
                            ))}
                          </Td>
                          {isAdvanced ? (
                            <Td className="font-mono text-xs text-slate-500">
                              {Object.entries(row.attributesExt)
                                .filter(([key]) =>
                                  [
                                    "source",
                                    "claim_type",
                                    "sys_code",
                                    "cav_flag",
                                    "fee_code"
                                  ].includes(key)
                                )
                                .map(([key, value]) => `${key}=${value ?? ""}`)
                                .join("; ")}
                            </Td>
                          ) : null}
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold text-slate-700">处理记录</h3>
              <div className="space-y-2">
                {data.logs.length === 0 ? (
                  <div className="text-xs text-slate-400">暂无处理记录</div>
                ) : (
                  data.logs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                    >
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-700">
                          {LOG_ACTION_LABELS[log.action] ?? log.action}
                        </span>
                        <span className="text-slate-400">{formatDate(log.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-slate-500">
                        {labelOf(DIFF_STATUS_LABELS, log.fromStatus)} →{" "}
                        {labelOf(DIFF_STATUS_LABELS, log.toStatus)} · {log.actor}
                      </div>
                      {log.note === null ? null : (
                        <div className="mt-1 text-slate-600">{log.note}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
