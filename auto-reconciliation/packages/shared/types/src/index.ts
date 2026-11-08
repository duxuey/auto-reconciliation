/** 通用分页参数 */
export interface PagedQuery {
  pageNo: number;
  pageSize: number;
}

/** 通用分页结果 */
export interface PagedResult<T> {
  items: T[];
  total: number;
  pageNo: number;
  pageSize: number;
}

/** 侧别 */
export type Side = "LEFT" | "RIGHT";

/** 指标阶段 */
export type CheckStage = "INTERFACE" | "PRE_BOOKING" | "POST_BOOKING";

/** 指标执行模式 */
export type RunMode = "FULL" | "DRY_RUN";

/** 动态金额集合：字段代码 -> decimal 字符串 */
export type AmountMap = Record<string, string>;

/** 业务键集合：字段代码 -> 归一化字符串或 null */
export type KeyMap = Record<string, string | null>;

/** 归一化后的单侧记录（进入指标引擎的最小结构） */
export interface NormalizedRecord {
  side: Side;
  datasetCode: string;
  sourceSystem: string;
  externalId: string;
  periodCode: string;
  businessKey: KeyMap;
  amounts: AmountMap;
  currency: string | null;
  businessDate: string | null;
  recordStatus: string | null;
  /** 过滤/例外判断用的原始属性（来源、类型代码等通用字段） */
  attributes: Record<string, string | null>;
  /** 脱敏后的原始载荷，仅用于追溯 */
  raw?: Record<string, unknown>;
}
