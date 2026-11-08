import { useState } from "react";
import { DiffDrawer } from "../components/DiffDrawer";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { ResultBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Field, Select } from "../components/ui/input";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { downloadAdjustments } from "../lib/api";
import { friendlyError } from "../lib/errors";
import { formatDate, formatMoney } from "../lib/format";
import {
  ADJUSTMENT_STATUS_LABELS,
  ADJUSTMENT_TYPE_LABELS,
  labelOf
} from "../lib/labels";
import { usePageFilters } from "../lib/pageFilters";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

export function AdjustmentsPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { pairId, environmentId, isAdvanced, searchParams } = usePageFilters();
  const { pair } = useScope();
  const [status, setStatus] = useState(() => searchParams.get("status") ?? "");
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<{
    id: string;
    adjustmentNo: string;
  } | null>(null);

  const adjustments = trpc.adjustment.list.useQuery(
    {
      pairId,
      environmentId,
      ...(status === "" ? {} : { status })
    },
    { enabled: pairId !== undefined }
  );

  async function invalidate(): Promise<void> {
    await utils.adjustment.list.invalidate();
  }

  const submit = trpc.adjustment.submit.useMutation({
    onSuccess: async () => {
      toast.success("调整建议已提交审批。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const approve = trpc.adjustment.approve.useMutation({
    onSuccess: async () => {
      setApproveTarget(null);
      toast.success("调整建议已审批通过。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const reject = trpc.adjustment.reject.useMutation({
    onSuccess: async () => {
      toast.success("调整建议已驳回。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });

  return (
    <div>
      <PageHeader
        title="调整建议"
        description={`${pair?.pairName ?? "当前对账关系"}；提交、审批、导出均留痕，不会直接记账`}
      />

      <Card className="mb-4">
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="状态">
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">全部</option>
                {Object.entries(ADJUSTMENT_STATUS_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>调整建议（{adjustments.data?.length ?? 0}）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryState isLoading={adjustments.isLoading} error={adjustments.error}>
            <Table>
              <thead>
                <tr>
                  <Th>建议编号</Th>
                  <Th>关联差异</Th>
                  <Th>建议类型</Th>
                  <Th>金额</Th>
                  <Th>状态</Th>
                  <Th>原因</Th>
                  <Th>创建时间</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {(adjustments.data ?? []).length === 0 ? (
                  <EmptyRow colSpan={8}>暂无调整建议</EmptyRow>
                ) : (
                  (adjustments.data ?? []).map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <Td className="font-mono text-xs">{row.adjustmentNo}</Td>
                      <Td>
                        <button
                          type="button"
                          className="text-left text-blue-600 hover:underline"
                          onClick={() => setSelectedDiffId(row.diffId)}
                        >
                          <div className="max-w-[220px] truncate text-xs">
                            {row.businessKeyText ?? "查看差异详情"}
                          </div>
                          {isAdvanced ? (
                            <div className="font-mono text-[11px] text-slate-400">
                              {row.metricCode ?? row.diffId}
                            </div>
                          ) : null}
                        </button>
                      </Td>
                      <Td className="text-xs">
                        {labelOf(ADJUSTMENT_TYPE_LABELS, row.adjustmentType)}
                      </Td>
                      <Td className="text-right font-mono text-xs">
                        {formatMoney(row.amount)} {row.currency}
                      </Td>
                      <Td>
                        <ResultBadge
                          result={row.adjustmentStatus}
                          label={labelOf(ADJUSTMENT_STATUS_LABELS, row.adjustmentStatus)}
                        />
                      </Td>
                      <Td className="max-w-[280px] truncate text-xs" title={row.reason}>
                        {row.reason}
                      </Td>
                      <Td className="text-xs text-slate-500">{formatDate(row.createdAt)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {row.adjustmentStatus === "DRAFT" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={submit.isPending}
                              onClick={() => submit.mutate({ id: row.id })}
                            >
                              提交审批
                            </Button>
                          ) : null}
                          {row.adjustmentStatus === "SUBMITTED" ? (
                            <>
                              <Button
                                size="sm"
                                disabled={approve.isPending}
                                onClick={() =>
                                  setApproveTarget({
                                    id: row.id,
                                    adjustmentNo: row.adjustmentNo
                                  })
                                }
                              >
                                审批通过
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={reject.isPending}
                                onClick={() => reject.mutate({ id: row.id })}
                              >
                                驳回
                              </Button>
                            </>
                          ) : null}
                          {row.adjustmentStatus === "APPROVED" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                void downloadAdjustments([row.id])
                                  .then(() =>
                                    toast.success(`已导出 ${row.adjustmentNo}`)
                                  )
                                  .catch((error: unknown) =>
                                    toast.error(friendlyError(error, isAdvanced))
                                  );
                              }}
                            >
                              导出
                            </Button>
                          ) : null}
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

      <ConfirmDialog
        open={approveTarget !== null}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        title="审批调整建议"
        description={`确认审批通过 ${approveTarget?.adjustmentNo ?? ""}？审批为 L3 操作，将写入审计记录。`}
        confirmLabel="确认审批"
        busy={approve.isPending}
        onConfirm={() => {
          if (approveTarget !== null) {
            approve.mutate({ id: approveTarget.id, confirm: true });
          }
        }}
      />

      <DiffDrawer diffId={selectedDiffId} onClose={() => setSelectedDiffId(null)} />
    </div>
  );
}
