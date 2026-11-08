export type Governance = "L1" | "L2" | "L3";

export interface ContractMeta {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  governance: Governance;
  errors: string[];
  examples?: unknown[];
}

/** 路由注册处的契约元数据；由提取器机械投影为 OpenAPI/台账 */
export const routeContracts: ContractMeta[] = [];

export function recordContract(meta: ContractMeta): void {
  routeContracts.push(meta);
}

/** 契约路径使用 {id} 风格；Hono 内部需要 :id，翻译只发生在这里 */
export function toHonoPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1");
}
