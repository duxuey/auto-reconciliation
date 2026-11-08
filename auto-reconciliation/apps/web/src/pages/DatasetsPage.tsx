import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import { Field, Input, Select } from "../components/ui/input";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { syncDataset, uploadImport } from "../lib/api";
import { formatDate, shortId } from "../lib/format";
import {
  IMPORT_STATUS_LABELS,
  PACK_STATUS_LABELS,
  TRANSPORT_LABELS,
  labelOf
} from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

const DEFAULT_START = "2026-10-01";
const DEFAULT_END = "2026-10-31";

function ErrorDialog({
  batchId,
  onClose
}: {
  batchId: string | null;
  onClose: () => void;
}) {
  const errors = trpc.importBatch.errors.useQuery(
    { id: batchId ?? "" },
    { enabled: batchId !== null }
  );
  return (
    <Dialog open={batchId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入行错误</DialogTitle>
          <DialogDescription>逐行校验失败信息，修正源文件后可重新上传</DialogDescription>
        </DialogHeader>
        <QueryState isLoading={errors.isLoading} error={errors.error}>
          <Table>
            <thead>
              <tr>
                <Th>行号</Th>
                <Th>错误码</Th>
                <Th>错误信息</Th>
              </tr>
            </thead>
            <tbody>
              {(errors.data ?? []).length === 0 ? (
                <EmptyRow colSpan={3}>无错误行</EmptyRow>
              ) : (
                (errors.data ?? []).map((error) => (
                  <tr key={error.id}>
                    <Td>{error.rowNo}</Td>
                    <Td className="text-xs">{error.errorCode}</Td>
                    <Td className="text-xs text-red-600">{error.errorMessage}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

export function DatasetsPage() {
  const utils = trpc.useUtils();
  const { environmentId, environment } = useScope();
  const datasets = trpc.dataset.list.useQuery();
  const batches = trpc.importBatch.list.useQuery({ environmentId });
  const [datasetCode, setDatasetCode] = useState("");
  const [startDate, setStartDate] = useState(DEFAULT_START);
  const [endDate, setEndDate] = useState(DEFAULT_END);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [syncingCode, setSyncingCode] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [errorBatchId, setErrorBatchId] = useState<string | null>(null);

  async function syncOne(code: string): Promise<void> {
    setSyncingCode(code);
    setSyncMessage(null);
    try {
      await syncDataset({
        datasetCode: code,
        environmentId,
        periodStartDate: startDate,
        periodEndDate: endDate
      });
      setSyncMessage(`${code} 读库同步完成，可在下方导入批次中查看结果。`);
      await utils.importBatch.list.invalidate();
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncingCode(null);
    }
  }

  async function submit(): Promise<void> {
    if (datasetCode === "" || file === null) {
      setMessage("请选择数据集和文件");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      await uploadImport({
        datasetCode,
        environmentId,
        periodStartDate: startDate,
        periodEndDate: endDate,
        file
      });
      setMessage("导入完成，可在下方导入批次中查看结果。");
      await utils.importBatch.list.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="数据接入"
        description={`当前环境：${environment?.envName ?? "未选择"} · 对账执行时默认直连源库；此处读库同步用于预检或补数`}
      />
      {syncMessage === null ? null : (
        <div className="mb-4 break-all rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          同步结果：{syncMessage}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>上传 CSV / JSON</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="数据集">
              <Select value={datasetCode} onChange={(event) => setDatasetCode(event.target.value)}>
                <option value="">请选择数据集</option>
                {(datasets.data ?? []).map((dataset) => (
                  <option key={dataset.datasetCode} value={dataset.datasetCode}>
                    {dataset.datasetCode} · {dataset.datasetName}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="期间起">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="期间止">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
            <Field label="文件">
              <input
                type="file"
                accept=".csv,.json"
                className="block w-full text-xs text-slate-600"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <Button onClick={submit} disabled={uploading} className="w-full">
              {uploading ? "上传中…" : "上传并导入"}
            </Button>
            {message === null ? null : (
              <p className="break-all rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                {message}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>数据集</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <QueryState isLoading={datasets.isLoading} error={datasets.error}>
              <Table>
                <thead>
                  <tr>
                    <Th>数据集</Th>
                    <Th>源系统</Th>
                    <Th>系统 / schema</Th>
                    <Th>传输</Th>
                    <Th>抽取 profile</Th>
                    <Th>映射哈希</Th>
                    <Th>状态</Th>
                    <Th>操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {(datasets.data ?? []).length === 0 ? (
                    <EmptyRow colSpan={8}>暂无数据集</EmptyRow>
                  ) : (
                    (datasets.data ?? []).map((dataset) => (
                      <tr key={dataset.id}>
                        <Td>
                          <div className="font-medium">{dataset.datasetCode}</div>
                          <div className="text-[11px] text-slate-500">{dataset.datasetName}</div>
                        </Td>
                        <Td>{dataset.sourceSystem}</Td>
                        <Td className="text-xs">
                          {dataset.systemCode === null ? (
                            <span className="text-slate-400">旧配置</span>
                          ) : (
                            <>
                              <div className="font-mono">{dataset.systemCode}</div>
                              <div className="text-slate-500">{dataset.schemaKey}</div>
                            </>
                          )}
                        </Td>
                        <Td>
                          <Badge tone={dataset.transport === "READONLY_SQL" ? "info" : "neutral"}>
                            {labelOf(TRANSPORT_LABELS, dataset.transport)}
                          </Badge>
                        </Td>
                        <Td className="font-mono text-[11px]">{dataset.extractProfile ?? "-"}</Td>
                        <Td className="font-mono text-[11px]">{shortId(dataset.mappingHash)}</Td>
                        <Td>
                          {labelOf(PACK_STATUS_LABELS, dataset.datasetStatus)}
                        </Td>
                        <Td>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              dataset.transport !== "READONLY_SQL" || syncingCode !== null
                            }
                            onClick={() => void syncOne(dataset.datasetCode)}
                          >
                            {syncingCode === dataset.datasetCode ? "同步中…" : "读库同步"}
                          </Button>
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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>导入批次</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryState isLoading={batches.isLoading} error={batches.error}>
            <Table>
              <thead>
                <tr>
                  <Th>数据集</Th>
                  <Th>文件</Th>
                  <Th>状态</Th>
                  <Th>总行</Th>
                  <Th>成功</Th>
                  <Th>失败</Th>
                  <Th>时间</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {(batches.data ?? []).length === 0 ? (
                  <EmptyRow colSpan={8}>暂无导入批次</EmptyRow>
                ) : (
                  (batches.data ?? []).map((batch) => (
                    <tr key={batch.id} className="hover:bg-slate-50">
                      <Td>{batch.datasetCode}</Td>
                      <Td className="text-xs">{batch.fileName ?? batch.syncKey ?? "-"}</Td>
                      <Td>
                        <Badge
                          tone={
                            batch.importStatus === "LOADED"
                              ? "success"
                              : batch.importStatus === "FAILED"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {labelOf(IMPORT_STATUS_LABELS, batch.importStatus)}
                        </Badge>
                      </Td>
                      <Td>{batch.rowTotal}</Td>
                      <Td>{batch.rowLoaded}</Td>
                      <Td className={batch.rowRejected > 0 ? "text-red-600" : ""}>
                        {batch.rowRejected}
                      </Td>
                      <Td className="text-xs text-slate-500">{formatDate(batch.createdAt)}</Td>
                      <Td>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={batch.rowRejected === 0}
                          onClick={() => setErrorBatchId(batch.id)}
                        >
                          查看错误
                        </Button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      <ErrorDialog batchId={errorBatchId} onClose={() => setErrorBatchId(null)} />
    </div>
  );
}
