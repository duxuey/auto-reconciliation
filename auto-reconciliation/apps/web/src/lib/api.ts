import { apiBase } from "./trpc";

/** 文件上传/CSV 导出等非 tRPC 场景的薄封装 */
export async function uploadImport(input: {
  datasetCode: string;
  environmentId?: string;
  periodStartDate: string;
  periodEndDate: string;
  file: File;
}): Promise<unknown> {
  const form = new FormData();
  form.set("datasetCode", input.datasetCode);
  if (input.environmentId !== undefined) {
    form.set("environmentId", input.environmentId);
  }
  form.set("periodStartDate", input.periodStartDate);
  form.set("periodEndDate", input.periodEndDate);
  form.set("file", input.file);
  const response = await fetch(`${apiBase}/api/reconciliation/import-batches`, {
    method: "POST",
    headers: { "x-actor": "user:web" },
    body: form
  });
  const body = (await response.json()) as { data?: unknown; message?: string };
  if (!response.ok) {
    throw new Error(body.message ?? `上传失败（HTTP ${response.status}）`);
  }
  return body.data;
}

/** 生产读库：按期间执行登记过的只读抽取 SQL */
export async function syncDataset(input: {
  datasetCode: string;
  environmentId?: string;
  periodStartDate: string;
  periodEndDate: string;
}): Promise<unknown> {
  const response = await fetch(
    `${apiBase}/api/reconciliation/datasets/${encodeURIComponent(input.datasetCode)}/sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor": "user:web"
      },
      body: JSON.stringify({
        environmentId: input.environmentId,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate
      })
    }
  );
  const body = (await response.json()) as { data?: unknown; message?: string };
  if (!response.ok) {
    throw new Error(body.message ?? `读库同步失败（HTTP ${response.status}）`);
  }
  return body.data;
}

