import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

export interface LegacyMysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  /** 连接超时（毫秒），避免源库不可达时页面/调度长时间挂起 */
  connectTimeout?: number;
}

/**
 * 只读抽取配置：profile 是代码内登记的字面量白名单。
 * 不接受调用方传 SQL/表名，避免动态 SQL 与跨库访问。
 */
export const EXTRACT_PROFILES = {
  RP_RI_BILL: {
    database: "fpic_rp_db",
    sqlFile: "rp_ri_bill.sql",
    description: "收付再保账单主表 + 明细表"
  },
  RI_ACC_FAC_IN: {
    database: "fpic_ri_acc_db",
    sqlFile: "ri_acc_fac_in.sql",
    description: "再保临分送收付"
  },
  RI_ACC_TRTY_IN: {
    database: "fpic_ri_acc_db",
    sqlFile: "ri_acc_trty_in.sql",
    description: "再保合约送收付"
  },
  RI_ACC_XOL_TRTY_IN: {
    database: "fpic_ri_acc_db",
    sqlFile: "ri_acc_xol_trty_in.sql",
    description: "再保超赔送收付"
  },
  IFAC_PLCY: {
    database: "fpic_ifac_db",
    sqlFile: "ifac_plcy.sql",
    description: "临分分入承保（核保通过时间）"
  },
  RI_INTF_PLCY: {
    database: "fpic_ri_risk_db",
    sqlFile: "ri_intf_plcy.sql",
    description: "再保承保接口"
  },
  CLM_OUTST: {
    database: "fpic_clm_db",
    sqlFile: "clm_outst.sql",
    description: "理赔未决主表"
  },
  RI_INTF_CLM_OUTST: {
    database: "fpic_ri_risk_db",
    sqlFile: "ri_intf_clm_outst.sql",
    description: "再保理赔未决接口"
  },
  CLM_OUTST_COINS: {
    database: "fpic_clm_db",
    sqlFile: "clm_outst_coins.sql",
    description: "理赔共保明细"
  },
  RI_INTF_CLM_COINS: {
    database: "fpic_ri_risk_db",
    sqlFile: "ri_intf_clm_coins.sql",
    description: "再保理赔共保接口"
  },
  IFAC_CLM_OUTST: {
    database: "fpic_ifac_db",
    sqlFile: "ifac_clm_outst.sql",
    description: "临分分入理赔"
  },
  RI_INTF_CLM_OUTST_FAC: {
    database: "fpic_ri_risk_db",
    sqlFile: "ri_intf_clm_outst_fac.sql",
    description: "再保理赔接口（临分分入）"
  },
  CLM_OUTST_DTL: {
    database: "fpic_clm_db",
    sqlFile: "clm_outst_dtl.sql",
    description: "理赔险别赔款/费用"
  },
  RI_INTF_CLM_CVRG_FEE: {
    database: "fpic_ri_risk_db",
    sqlFile: "ri_intf_clm_cvrg_fee.sql",
    description: "再保理赔险别赔款/费用"
  }
} as const;

export type ExtractProfileCode = keyof typeof EXTRACT_PROFILES;

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "sql");

export function createLegacyPool(config: LegacyMysqlConfig): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit ?? 5,
    connectTimeout: config.connectTimeout ?? 10_000,
    namedPlaceholders: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  });
}

export interface ExtractParams {
  periodStartDate: string;
  periodEndDate: string;
}

/**
 * 执行登记过的只读抽取 SQL；参数化传入期间，不允许调用方提供 SQL。
 * 物理 schema 由环境配置传入，SQL 中使用 {{schema}} 占位，避免把库名写死。
 */
export async function runExtract(
  pool: Pool,
  profileCode: ExtractProfileCode,
  params: ExtractParams,
  schemaName?: string
): Promise<Record<string, string>[]> {
  const profile = EXTRACT_PROFILES[profileCode];
  const template = await readFile(join(SQL_DIR, profile.sqlFile), "utf8");
  const usesSchemaPlaceholder = template.includes("{{schema}}");
  if (usesSchemaPlaceholder) {
    if (schemaName === undefined || !/^[A-Za-z0-9_]+$/.test(schemaName)) {
      throw new Error(
        `抽取 SQL ${profile.sqlFile} 需要合法的 schema 名称，实际: ${schemaName ?? "空"}`
      );
    }
  }
  const sql = usesSchemaPlaceholder
    ? template.replaceAll("{{schema}}", schemaName as string)
    : template;
  // 部分数据集是 UNION（险别赔款/费用），会重复出现一组期间参数
  const placeholderCount = (sql.match(/\?/g) ?? []).length;
  if (placeholderCount === 0 || placeholderCount % 2 !== 0) {
    throw new Error(`抽取 SQL ${profile.sqlFile} 的期间占位符数量非法: ${placeholderCount}`);
  }
  const bindValues = Array.from({ length: placeholderCount / 2 }, () => [
    params.periodStartDate,
    params.periodEndDate
  ]).flat();
  const [rows] = await pool.query<RowDataPacket[]>(sql, bindValues);
  return rows.map((row) => {
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      output[key] = value === null || value === undefined ? "" : String(value);
    }
    return output;
  });
}

export async function pingLegacy(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
