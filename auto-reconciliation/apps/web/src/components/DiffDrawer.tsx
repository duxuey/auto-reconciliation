import { useEffect, useState } from "react";
import { Badge, ResultBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Field, Input, Select } from "./ui/input";
import { EmptyRow, Table, Td, Th } from "./ui/table";
import { useToast } from "./ui/toast";
import { friendlyError } from "../lib/errors";
import { absMoneyString, formatDate, formatMoney } from "../lib/format";
import {
  ADJUSTMENT_TYPE_LABELS,
  DIFF_STATUS_LABELS,
  RESOLUTION_TYPE_LABELS,
  diffTypeLabel,
  labelOf
} from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

type AdjustmentType =
  | "SUPPLEMENT_RECEIPT"
  | "SUPPLEMENT_PAYMENT"
  | "REVERSAL"
  | "DATA_FIX"
  | "CONFIRM_WRITE_OFF";

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
  const utils = trpc.useUtils();
  const toast = useToast();
  const { isAdvanced } = useScope();
  const detail = trpc.diff.byId.useQuery(
    { id: diffId ?? "" },
    { enabled: diffId !== null }
  );
  const [assignee, setAssignee] = useState("");
  const [resolutionType, setResolutionType] = useState("DATA_FIX");
  const [note, setNote] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("DATA_FIX");
  const [adjustmentAmount, setAdjustmentAmount] = useState("0.0000");
  const [adjustmentCurrency, setAdjustmentCurrency] = useState("CNY");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [confirmWriteOff, setConfirmWriteOff] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);

  useEffect(() => {
    setAssignee("");
    setNote("");
    setAdjustmentReason("");
  }, [diffId]);

  const data = detail.data;

  useEffect(() => {
    if (data === undefined) {
      return;
    }
    setAdjustmentAmount(absMoneyString(data.diff.diffValue));
    setAdjustmentCurrency(data.diff.currency ?? "CNY");
  }, [data?.diff.id, data?.diff.diffValue, data?.diff.currency]);

  async function invalidate(): Promise<void> {
    if (diffId !== null) {
      await utils.diff.byId.invalidate({ id: diffId });
    }
    await utils.diff.list.invalidate();
    await utils.run.diffs.invalidate();
    await utils.report.overview.invalidate();
    await utils.adjustment.list.invalidate();
  }

  const assign = trpc.diff.assign.useMutation({
    onSuccess: async () => {
      toast.success("已指派处理人。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const investigate = trpc.diff.investigate.useMutation({
    onSuccess: async () => {
      toast.success("已标记为处理中。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const resolve = trpc.diff.resolve.useMutation({
    onSuccess: async () => {
      toast.success("差异已解决。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const comment = trpc.diff.comment.useMutation({
    onSuccess: async () => {
      toast.success("备注已记录。");
      setNote("");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const writeOff = trpc.diff.writeOff.useMutation({
    onSuccess: async () => {
      setConfirmWriteOff(false);
      toast.success("差异已核销，审计记录已写入。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const reopen = trpc.diff.reopen.useMutation({
    onSuccess: async () => {
      setConfirmReopen(false);
      toast.success("差异已重开。");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });
  const createAdjustment = trpc.diff.createAdjustment.useMutation({
    onSuccess: async () => {
      toast.success("调整建议已生成。");
      await invalidate();
      setAdjustmentReason("");
    },
    onError: (error) => toast.error(friendlyError(error, isAdvanced))
  });

  const version = data?.diff.version;
  const status = data?.diff.diffStatus;
  const canAssign = status === "OPEN";
  const canInvestigate = status === "OPEN" || status === "ASSIGNED";
  const canResolve =
    status === "OPEN" || status === "ASSIGNED" || status === "INVESTIGATING";
  const canWriteOff =
    status === "OPEN" || status === "ASSIGNED" || status === "INVESTIGATING";
  const canReopen = status === "RESOLVED" || status === "WRITTEN_OFF";

  return (
    <>
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
              查看左右值、来源记录与处理记录；处理动作会写入只增不改的差异流水
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
                    <div className="text-[11px] text-slate-500">左侧</div>
                    <div className="mt-1 font-mono text-sm">
                      {formatMoney(data.diff.leftValue)}
                    </div>
                    {data.diff.leftText === null ? null : (
                      <div className="mt-1 text-[11px] text-slate-500">
                        {data.diff.leftText}
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-500">右侧</div>
                    <div className="mt-1 font-mono text-sm">
                      {formatMoney(data.diff.rightValue)}
                    </div>
                    {data.diff.rightText === null ? null : (
                      <div className="mt-1 text-[11px] text-slate-500">
                        {data.diff.rightText}
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 p-3">
                    <div className="text-[11px] text-red-500">差异</div>
                    <div className="mt-1 font-mono text-sm text-red-700">
                      {formatMoney(data.diff.diffValue)}
                    </div>
                    {isAdvanced ? (
                      <div className="mt-1 text-[11px] text-red-500">
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
                            <Td className="font-mono text-[11px]">{row.externalId}</Td>
                            <Td className="font-mono text-[11px]">
                              {Object.entries(row.amountsExt).map(([field, value]) => (
                                <div key={field}>
                                  {isAdvanced ? `${field}: ` : ""}
                                  {formatMoney(value)}
                                </div>
                              ))}
                            </Td>
                            {isAdvanced ? (
                              <Td className="font-mono text-[11px] text-slate-500">
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

              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-700">处理动作</h3>
                {canAssign ? (
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <Field label="指派处理人">
                      <Input
                        placeholder="输入处理人"
                        value={assignee}
                        onChange={(event) => setAssignee(event.target.value)}
                      />
                    </Field>
                    <div className="flex items-end">
                      <Button
                        variant="outline"
                        disabled={assignee.trim() === "" || assign.isPending}
                        onClick={() =>
                          assign.mutate({
                            id: data.diff.id,
                            assignee: assignee.trim(),
                            expectedVersion: version
                          })
                        }
                      >
                        指派
                      </Button>
                    </div>
                  </div>
                ) : null}

                {canResolve ? (
                  <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
                    <Field label="解决类型">
                      <Select
                        value={resolutionType}
                        onChange={(event) => setResolutionType(event.target.value)}
                      >
                        {Object.entries(RESOLUTION_TYPE_LABELS).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="处理说明">
                      <Input value={note} onChange={(event) => setNote(event.target.value)} />
                    </Field>
                    <div className="flex items-end gap-2">
                      <Button
                        disabled={note.trim() === "" || resolve.isPending}
                        onClick={() =>
                          resolve.mutate({
                            id: data.diff.id,
                            resolutionType,
                            note: note.trim(),
                            expectedVersion: version
                          })
                        }
                      >
                        标记已解决
                      </Button>
                      <Button
                        variant="outline"
                        disabled={note.trim() === "" || comment.isPending}
                        onClick={() => comment.mutate({ id: data.diff.id, note: note.trim() })}
                      >
                        备注
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {canInvestigate ? (
                    <Button
                      variant="outline"
                      disabled={investigate.isPending}
                      onClick={() =>
                        investigate.mutate({
                          id: data.diff.id,
                          expectedVersion: version
                        })
                      }
                    >
                      开始调查
                    </Button>
                  ) : null}
                  {canWriteOff ? (
                    <Button
                      variant="danger"
                      disabled={writeOff.isPending}
                      onClick={() => setConfirmWriteOff(true)}
                    >
                      核销
                    </Button>
                  ) : null}
                  {canReopen ? (
                    <Button
                      variant="outline"
                      disabled={reopen.isPending}
                      onClick={() => setConfirmReopen(true)}
                    >
                      重开差异
                    </Button>
                  ) : null}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-700">调整建议</h3>
                <p className="text-[11px] text-slate-500">
                  生成的是给责任系统的纠错建议，不会记账或直接驱动收付。
                </p>
                <div className="grid gap-2 md:grid-cols-[180px_140px_100px]">
                  <Field label="建议类型">
                    <Select
                      value={adjustmentType}
                      onChange={(event) =>
                        setAdjustmentType(event.target.value as AdjustmentType)
                      }
                    >
                      {Object.entries(ADJUSTMENT_TYPE_LABELS).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="金额">
                    <Input
                      value={adjustmentAmount}
                      onChange={(event) => setAdjustmentAmount(event.target.value)}
                    />
                  </Field>
                  <Field label="币种">
                    <Input
                      maxLength={3}
                      value={adjustmentCurrency}
                      onChange={(event) =>
                        setAdjustmentCurrency(event.target.value.toUpperCase())
                      }
                    />
                  </Field>
                </div>
                <Field label="原因">
                  <Input
                    placeholder="说明差异原因与期望修正动作"
                    value={adjustmentReason}
                    onChange={(event) => setAdjustmentReason(event.target.value)}
                  />
                </Field>
                <Button
                  disabled={
                    adjustmentReason.trim() === "" ||
                    adjustmentCurrency.length !== 3 ||
                    createAdjustment.isPending
                  }
                  onClick={() =>
                    createAdjustment.mutate({
                      id: data.diff.id,
                      adjustmentType,
                      amount: adjustmentAmount,
                      currency: adjustmentCurrency,
                      reason: adjustmentReason.trim()
                    })
                  }
                >
                  生成调整建议
                </Button>
                {createAdjustment.data === undefined ? null : (
                  <p className="text-xs text-emerald-600">
                    已生成 {createAdjustment.data.adjustmentNo}，可在「调整建议」页面提交审批。
                  </p>
                )}
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

      <ConfirmDialog
        open={confirmWriteOff}
        onOpenChange={setConfirmWriteOff}
        title="核销差异"
        description="核销为 L3 操作，确认后将写入审计流水且不会直接记账。"
        confirmLabel="确认核销"
        tone="danger"
        requireReason
        reasonLabel="核销原因"
        busy={writeOff.isPending}
        onConfirm={(reason) => {
          if (data !== undefined) {
            writeOff.mutate({
              id: data.diff.id,
              note: reason,
              confirm: true,
              expectedVersion: version
            });
          }
        }}
      />

      <ConfirmDialog
        open={confirmReopen}
        onOpenChange={setConfirmReopen}
        title="重开差异"
        description="重开后差异将回到「待处理」，需要重新跟进。"
        confirmLabel="确认重开"
        requireReason
        reasonLabel="重开原因"
        busy={reopen.isPending}
        onConfirm={(reason) => {
          if (data !== undefined) {
            reopen.mutate({
              id: data.diff.id,
              note: reason,
              expectedVersion: version
            });
          }
        }}
      />
    </>
  );
}
