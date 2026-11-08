import type {
  DatasetMapping,
  MetricConfig,
  PackConfig,
  CheckStage
} from "@infra/biz-reconciliation-engine";

export interface DatasetSeed {
  datasetCode: string;
  datasetName: string;
  sourceSystem: string;
  /** 归属业务系统（environment_system 的 system_code）；为空时按旧配置回退。 */
  systemCode?: string;
  /** 数据集所属物理 schema 的逻辑名，对应环境×系统 schemaMap 的键。 */
  schemaKey?: string;
  sourceSchema: string;
  transport: "FILE" | "READONLY_SQL";
  extractProfile?: string;
  mapping: DatasetMapping;
}

export interface PackSeed {
  packCode: string;
  packName: string;
  checkStage: CheckStage;
  /** 绑定的系统对账关系（pair_code）。 */
  pairCode?: string;
  description: string;
  config: PackConfig;
  sourceScripts: string[];
}

export interface EnvironmentSeed {
  envCode: string;
  envName: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPasswordEnvKey: string;
  defaultDatabase?: string;
  isDefault?: boolean;
  description?: string;
}

export interface SystemSeed {
  systemCode: string;
  systemName: string;
  systemType: "UNDERWRITING" | "CLAIM" | "REINSURANCE" | "RECEIVABLE_PAYABLE";
  description?: string;
  sortOrder: number;
}

export interface EnvironmentSystemSeed {
  envCode: string;
  systemCode: string;
  schemaMap: Record<string, string>;
}

export interface PairSeed {
  pairCode: string;
  pairName: string;
  leftSystemCode: string;
  rightSystemCode: string;
  description?: string;
  sortOrder: number;
}

const rpKey = {
  rp_batch_no: "c_batch_no",
  dept_code: "c_dept_code",
  bill_period: "c_bill_period",
  trty_no: "c_trty_no",
  bill_type: "c_bill_type",
  prtc_mark: "c_prtc_mark",
  bill_currency: "c_fee_currency",
  item_code: "c_fee_code"
} as const;

const rpAmounts = {
  item_amnt: "n_fee_amnt",
  item_rmb_amnt: "n_rmb_fee_amnt"
} as const;

const rpAttributes = {
  fee_code: "c_fee_code",
  cav_flag: "c_cav_flag"
} as const;

const uwKey = {
  appl_no: "c_appl_no",
  plcy_no: "c_plcy_no",
  endr_no: "c_endr_no",
  endr_tms: "n_endr_tms",
  kind_no: "c_kind_no",
  prod_no: "c_prod_no",
  dept_code: "c_dept_code",
  bsns_src: "c_bsns_src",
  amnt_cur: "c_amnt_cur",
  prem_cur: "c_prem_cur"
} as const;

const uwAmounts = {
  amnt: "n_amnt",
  amnt_var: "n_amnt_var",
  rmb_amnt: "n_rmb_amnt",
  rmb_amnt_var: "n_rmb_amnt_var",
  prem: "n_prem",
  prem_var: "n_prem_var",
  notax_prem: "n_notax_prem",
  notax_prem_var: "n_notax_prem_var",
  rmb_prem: "n_rmb_prem",
  rmb_prem_var: "n_rmb_prem_var",
  rmb_notax_prem: "n_rmb_notax_prem",
  rmb_notax_prem_var: "n_rmb_notax_prem_var",
  vat_amnt: "n_vat_amnt",
  vat_amnt_var: "n_vat_amnt_var",
  rmb_vat_amnt: "n_rmb_vat_amnt",
  rmb_vat_amnt_var: "n_rmb_vat_amnt_var"
} as const;

const clmKey = {
  rgst_no: "c_rgst_no",
  outst_tms: "n_outst_tms",
  plcy_no: "c_plcy_no",
  prod_no: "c_prod_no",
  currency: "c_extract_currency"
} as const;

const clmAmounts = {
  outst_amnt: "n_this_outst_amnt",
  fee_outst_amnt: "n_this_fee_outst_amnt",
  this_settl_amnt: "n_this_settl_amnt",
  this_fee_settl_amnt: "n_this_fee_settl_amnt",
  rmb_outst_amnt: "n_e_this_outst_amnt",
  rmb_fee_outst_amnt: "n_e_this_fee_outst_amnt",
  rmb_this_settl_amnt: "n_e_this_settl_amnt",
  rmb_this_fee_settl_amnt: "n_e_this_fee_settl_amnt",
  rmb_exch: "n_extract_rmb_exch"
} as const;

export const DATASET_SEEDS: DatasetSeed[] = [
  {
    datasetCode: "RI_ACC_FAC_IN",
    datasetName: "再保临分送收付",
    sourceSystem: "FPIC_RI_ACC",
    systemCode: "RI",
    schemaKey: "ACC",
    sourceSchema: "fpic_ri_acc_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_ACC_FAC_IN",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: { ...rpKey },
      amounts: { ...rpAmounts },
      attributes: { ...rpAttributes },
      currency: "c_fee_currency",
      businessDate: "d_send_rp_time",
      periodCode: "c_bill_period",
      defaultValues: { c_prtc_mark: "0" }
    }
  },
  {
    datasetCode: "RI_ACC_TRTY_IN",
    datasetName: "再保合约送收付",
    sourceSystem: "FPIC_RI_ACC",
    systemCode: "RI",
    schemaKey: "ACC",
    sourceSchema: "fpic_ri_acc_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_ACC_TRTY_IN",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: { ...rpKey },
      amounts: { ...rpAmounts },
      attributes: { ...rpAttributes },
      currency: "c_fee_currency",
      businessDate: "d_send_rp_time",
      periodCode: "c_bill_period"
    }
  },
  {
    datasetCode: "RI_ACC_XOL_TRTY_IN",
    datasetName: "再保超赔送收付",
    sourceSystem: "FPIC_RI_ACC",
    systemCode: "RI",
    schemaKey: "ACC",
    sourceSchema: "fpic_ri_acc_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_ACC_XOL_TRTY_IN",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: { ...rpKey },
      amounts: { ...rpAmounts },
      attributes: { ...rpAttributes },
      currency: "c_fee_currency",
      businessDate: "d_send_rp_time",
      periodCode: "c_bill_period",
      defaultValues: { c_prtc_mark: "0" }
    }
  },
  {
    datasetCode: "RP_RI_BILL",
    datasetName: "收付再保账单主明细",
    sourceSystem: "FPIC_RP",
    systemCode: "RP",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_rp_db",
    transport: "READONLY_SQL",
    extractProfile: "RP_RI_BILL",
    mapping: {
      externalIdFields: ["c_inner_bill_no", "c_item_code"],
      businessKey: {
        rp_batch_no: "c_rp_batch_no",
        dept_code: "c_dept_code",
        bill_period: "c_bill_period",
        trty_no: "c_trty_no",
        bill_type: "c_bill_type",
        prtc_mark: "c_prtc_mark",
        bill_currency: "c_bill_currency",
        item_code: "c_item_code"
      },
      amounts: {
        item_amnt: "n_item_amnt",
        item_rmb_amnt: "n_item_rmb_amnt"
      },
      currency: "c_bill_currency",
      businessDate: "d_bill_time",
      periodCode: "c_bill_period",
      defaultValues: { c_prtc_mark: "0" }
    }
  },
  {
    datasetCode: "IFAC_PLCY",
    datasetName: "临分分入承保",
    sourceSystem: "FPIC_IFAC",
    systemCode: "NB_UW",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_ifac_db",
    transport: "READONLY_SQL",
    extractProfile: "IFAC_PLCY",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: { ...uwKey },
      amounts: { ...uwAmounts },
      attributes: {
        bsns_src: "c_bsns_src",
        migrate_flag: "c_migrate_flag"
      },
      currency: "c_amnt_cur",
      businessDate: "d_undr_qual_time"
    }
  },
  {
    datasetCode: "RI_INTF_PLCY",
    datasetName: "再保承保接口",
    sourceSystem: "FPIC_RI_RISK",
    systemCode: "RI",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_ri_risk_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_INTF_PLCY",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: { ...uwKey },
      amounts: { ...uwAmounts },
      attributes: {
        bsns_src: "c_bsns_src",
        migrate_flag: "c_migrate_flag",
        biz_type: "c_biz_type",
        rbk_seq: "n_rbk_seq"
      },
      currency: "c_amnt_cur",
      businessDate: "d_undr_qual_time"
    }
  },
  {
    datasetCode: "CLM_OUTST",
    datasetName: "理赔未决主表",
    sourceSystem: "FPIC_CLM",
    systemCode: "NB_CLM",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_clm_db",
    transport: "READONLY_SQL",
    extractProfile: "CLM_OUTST",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: { ...clmKey },
      amounts: { ...clmAmounts },
      attributes: {
        extract_outst_flag: "c_extract_outst_flag",
        migrate_flag: "c_migrate_flag",
        source: "c_source",
        sys_code: "c_sys_code"
      },
      currency: "c_extract_currency",
      businessDate: "d_outst_time"
    }
  },
  {
    datasetCode: "RI_INTF_CLM_OUTST",
    datasetName: "再保理赔未决接口",
    sourceSystem: "FPIC_RI_RISK",
    systemCode: "RI",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_ri_risk_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_INTF_CLM_OUTST",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: {
        rgst_no: "c_rgst_no",
        outst_tms: "n_orig_outst_tms",
        plcy_no: "c_plcy_no",
        prod_no: "c_prod_no",
        currency: "c_clm_cur"
      },
      amounts: {
        outst_amnt: "n_outst_amnt",
        fee_outst_amnt: "n_fee_outst_amnt",
        this_settl_amnt: "n_this_settl_amnt",
        this_fee_settl_amnt: "n_this_fee_settl_amnt",
        rmb_outst_amnt: "n_rmb_outst_amnt",
        rmb_fee_outst_amnt: "n_rmb_fee_outst_amnt",
        rmb_this_settl_amnt: "n_rmb_this_settl_amnt",
        rmb_this_fee_settl_amnt: "n_rmb_this_fee_settl_amnt",
        rmb_exch: "n_rmb_clm_exch"
      },
      attributes: {
        claim_type: "c_claim_type",
        rbk_seq: "n_rbk_seq",
        migrate_flag: "c_migrate_flag",
        inwd_mark: "c_inwd_mark"
      },
      currency: "c_clm_cur",
      businessDate: "d_clm_generate_time"
    }
  },
  {
    datasetCode: "CLM_OUTST_COINS",
    datasetName: "理赔共保明细（理赔侧）",
    sourceSystem: "FPIC_CLM",
    systemCode: "NB_CLM",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_clm_db",
    transport: "READONLY_SQL",
    extractProfile: "CLM_OUTST_COINS",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: {
        rgst_no: "c_rgst_no",
        outst_tms: "n_outst_tms",
        plcy_no: "c_plcy_no",
        prod_no: "c_prod_no",
        bsns_src: "c_bsns_src",
        currency: "c_extract_currency",
        coins_code: "c_coins_code"
      },
      amounts: {
        coins_outst_amnt: "n_coins_outst_amnt",
        coins_fee_outst_amnt: "n_coins_fee_outst_amnt",
        coins_this_settl_amnt: "n_coins_this_settl_amnt",
        coins_fee_settl_amnt: "n_coins_this_fee_settl_amnt"
      },
      attributes: {
        sys_code: "c_sys_code",
        extract_outst_flag: "c_extract_outst_flag",
        migrate_flag: "c_migrate_flag"
      },
      currency: "c_extract_currency",
      businessDate: "d_outst_time"
    }
  },
  {
    datasetCode: "RI_INTF_CLM_COINS",
    datasetName: "再保理赔共保接口（再保侧）",
    sourceSystem: "FPIC_RI_RISK",
    systemCode: "RI",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_ri_risk_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_INTF_CLM_COINS",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: {
        rgst_no: "c_rgst_no",
        outst_tms: "n_orig_outst_tms",
        plcy_no: "c_plcy_no",
        prod_no: "c_prod_no",
        bsns_src: "c_bsns_src",
        currency: "c_clm_cur",
        coins_code: "c_coins_code"
      },
      amounts: {
        coins_outst_amnt: "n_outst_amnt",
        coins_fee_outst_amnt: "n_fee_outst_amnt",
        coins_this_settl_amnt: "n_this_settl_amnt",
        coins_fee_settl_amnt: "n_this_fee_settl_amnt"
      },
      attributes: {
        claim_type: "c_claim_type",
        rbk_seq: "n_rbk_seq",
        migrate_flag: "c_migrate_flag",
        inwd_mark: "c_inwd_mark",
        bsns_src: "c_bsns_src"
      },
      currency: "c_clm_cur",
      businessDate: "d_clm_generate_time"
    }
  },
  {
    datasetCode: "IFAC_CLM_OUTST",
    datasetName: "临分分入理赔（理赔侧）",
    sourceSystem: "FPIC_IFAC",
    systemCode: "NB_UW",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_ifac_db",
    transport: "READONLY_SQL",
    extractProfile: "IFAC_CLM_OUTST",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: {
        rgst_no: "c_rgst_no",
        outst_tms: "n_outst_tms",
        plcy_no: "c_plcy_no",
        endr_tms: "n_endr_tms",
        kind_no: "c_kind_no",
        prod_no: "c_prod_no",
        dept_code: "c_dept_code",
        bsns_src: "c_bsns_src",
        currency: "c_extract_currency"
      },
      amounts: {
        outst_amnt: "n_outst_amnt",
        fee_outst_amnt: "n_fee_outst_amnt",
        this_settl_amnt: "n_this_settl_amnt",
        this_fee_settl_amnt: "n_this_fee_settl_amnt",
        rmb_outst_amnt: "n_rmb_outst_amnt",
        rmb_fee_outst_amnt: "n_rmb_fee_outst_amnt",
        rmb_this_settl_amnt: "n_rmb_this_settl_amnt",
        rmb_this_fee_settl_amnt: "n_rmb_this_fee_settl_amnt",
        rmb_exch: "n_rmb_exch"
      },
      attributes: {
        bsns_src: "c_bsns_src",
        migrate_flag: "c_migrate_flag"
      },
      currency: "c_extract_currency",
      businessDate: "d_outst_time"
    }
  },
  {
    datasetCode: "RI_INTF_CLM_OUTST_FAC",
    datasetName: "再保理赔接口（临分分入）",
    sourceSystem: "FPIC_RI_RISK",
    systemCode: "RI",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_ri_risk_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_INTF_CLM_OUTST_FAC",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: {
        rgst_no: "c_rgst_no",
        outst_tms: "n_orig_outst_tms",
        plcy_no: "c_plcy_no",
        endr_tms: "n_endr_tms",
        kind_no: "c_kind_no",
        prod_no: "c_prod_no",
        dept_code: "c_dept_code",
        bsns_src: "c_bsns_src",
        currency: "c_clm_cur"
      },
      amounts: {
        outst_amnt: "n_outst_amnt",
        fee_outst_amnt: "n_fee_outst_amnt",
        this_settl_amnt: "n_this_settl_amnt",
        this_fee_settl_amnt: "n_this_fee_settl_amnt",
        rmb_outst_amnt: "n_rmb_outst_amnt",
        rmb_fee_outst_amnt: "n_rmb_fee_outst_amnt",
        rmb_this_settl_amnt: "n_rmb_this_settl_amnt",
        rmb_this_fee_settl_amnt: "n_rmb_this_fee_settl_amnt",
        rmb_exch: "n_rmb_clm_exch"
      },
      attributes: {
        claim_type: "c_claim_type",
        rbk_seq: "n_rbk_seq",
        migrate_flag: "c_migrate_flag",
        inwd_mark: "c_inwd_mark",
        bsns_src: "c_bsns_src"
      },
      currency: "c_clm_cur",
      businessDate: "d_clm_generate_time"
    }
  },
  {
    datasetCode: "CLM_OUTST_DTL",
    datasetName: "理赔险别赔款/费用（理赔侧）",
    sourceSystem: "FPIC_CLM",
    systemCode: "NB_CLM",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_clm_db",
    transport: "READONLY_SQL",
    extractProfile: "CLM_OUTST_DTL",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: {
        rgst_no: "c_rgst_no",
        outst_tms: "n_outst_tms",
        plcy_no: "c_plcy_no",
        prod_no: "c_prod_no",
        currency: "c_extract_currency",
        tgt_seq_no: "n_tgt_seq_no",
        cvrg_no: "c_cvrg_no"
      },
      amounts: {
        cvrg_outst_amnt: "cvrg_outst_amnt",
        cvrg_this_settl_amnt: "cvrg_this_settl_amnt",
        cvrg_rmb_outst_amnt: "cvrg_rmb_outst_amnt",
        cvrg_rmb_this_settl_amnt: "cvrg_rmb_this_settl_amnt",
        fee_outst_amnt: "fee_outst_amnt",
        fee_this_settl_amnt: "fee_this_settl_amnt",
        fee_rmb_outst_amnt: "fee_rmb_outst_amnt",
        fee_rmb_this_settl_amnt: "fee_rmb_this_settl_amnt"
      },
      attributes: {
        extract_outst_flag: "c_extract_outst_flag",
        migrate_flag: "c_migrate_flag",
        source: "c_source"
      },
      currency: "c_extract_currency",
      businessDate: "d_outst_time"
    }
  },
  {
    datasetCode: "RI_INTF_CLM_CVRG_FEE",
    datasetName: "再保理赔险别赔款/费用（再保侧）",
    sourceSystem: "FPIC_RI_RISK",
    systemCode: "RI",
    schemaKey: "DEFAULT",
    sourceSchema: "fpic_ri_risk_db",
    transport: "READONLY_SQL",
    extractProfile: "RI_INTF_CLM_CVRG_FEE",
    mapping: {
      externalIdFields: ["c_pk_id"],
      businessKey: {
        rgst_no: "c_rgst_no",
        outst_tms: "n_orig_outst_tms",
        plcy_no: "c_plcy_no",
        prod_no: "c_prod_no",
        currency: "c_clm_cur",
        tgt_seq_no: "n_orig_tgt_seq_no",
        cvrg_no: "c_cvrg_no"
      },
      amounts: {
        cvrg_outst_amnt: "cvrg_outst_amnt",
        cvrg_this_settl_amnt: "cvrg_this_settl_amnt",
        cvrg_rmb_outst_amnt: "cvrg_rmb_outst_amnt",
        cvrg_rmb_this_settl_amnt: "cvrg_rmb_this_settl_amnt",
        fee_outst_amnt: "fee_outst_amnt",
        fee_this_settl_amnt: "fee_this_settl_amnt",
        fee_rmb_outst_amnt: "fee_rmb_outst_amnt",
        fee_rmb_this_settl_amnt: "fee_rmb_this_settl_amnt"
      },
      attributes: {
        claim_type: "c_claim_type",
        rbk_seq: "n_rbk_seq",
        migrate_flag: "c_migrate_flag",
        inwd_mark: "c_inwd_mark"
      },
      currency: "c_clm_cur",
      businessDate: "d_clm_generate_time"
    }
  }
];

const UW_METRICS: MetricConfig[] = [
  { code: "M001", name: "时间段内总记录条数是否一致", type: "ROW_COUNT" },
  { code: "M002", name: "业务键数量是否一致", type: "KEY_COUNT" },
  { code: "M003", name: "临分分入承保有、再保无", type: "MISSING_LEFT" },
  { code: "M004", name: "再保有、临分分入承保无", type: "MISSING_RIGHT" },
  { code: "M005", name: "同一业务键下记录条数是否一致", type: "RECORD_COUNT_PER_KEY" },
  { code: "M006", name: "临分分入承保侧业务键是否重复", type: "DUPLICATE_LEFT" },
  { code: "M007", name: "再保侧业务键是否重复", type: "DUPLICATE_RIGHT" },
  {
    code: "M008",
    name: "再保侧同业务键业务来源不是4000000",
    type: "SOURCE_ANOMALY",
    side: "RIGHT",
    sourceAnomaly: { mode: "NOT_IN", field: "bsns_src", allowed: ["4000000"] }
  },
  {
    code: "M101",
    name: "保额类金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: ["amnt", "amnt_var", "rmb_amnt", "rmb_amnt_var"]
  },
  {
    code: "M102",
    name: "保费类金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: [
      "prem",
      "prem_var",
      "notax_prem",
      "notax_prem_var",
      "rmb_prem",
      "rmb_prem_var",
      "rmb_notax_prem",
      "rmb_notax_prem_var"
    ]
  },
  {
    code: "M103",
    name: "税额类金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: ["vat_amnt", "vat_amnt_var", "rmb_vat_amnt", "rmb_vat_amnt_var"]
  }
];

const CLM_METRICS: MetricConfig[] = [
  { code: "M001", name: "时间段内总记录条数是否一致", type: "ROW_COUNT" },
  { code: "M002", name: "业务键数量是否一致", type: "KEY_COUNT" },
  { code: "M003", name: "理赔有、再保无", type: "MISSING_LEFT" },
  { code: "M004", name: "再保有、理赔无", type: "MISSING_RIGHT" },
  { code: "M005", name: "同一业务键下记录条数是否一致", type: "RECORD_COUNT_PER_KEY" },
  { code: "M006", name: "理赔侧业务键是否重复", type: "DUPLICATE_LEFT" },
  { code: "M007", name: "再保侧业务键是否重复", type: "DUPLICATE_RIGHT" },
  {
    code: "M008",
    name: "同一业务键是否跨多个理赔系统",
    type: "SOURCE_ANOMALY",
    side: "LEFT",
    sourceAnomaly: { mode: "DISTINCT_GT", field: "sys_code", maxDistinct: 1 }
  },
  {
    code: "M101",
    name: "未决类金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: ["outst_amnt", "fee_outst_amnt", "rmb_outst_amnt", "rmb_fee_outst_amnt"]
  },
  {
    code: "M102",
    name: "已决类金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: [
      "this_settl_amnt",
      "this_fee_settl_amnt",
      "rmb_this_settl_amnt",
      "rmb_this_fee_settl_amnt"
    ]
  },
  { code: "M109", name: "折人民币赔款兑换率是否一致", type: "RATE_FIELD", rateField: "rmb_exch" }
];

const CLM_COINS_METRICS: MetricConfig[] = [
  { code: "M201", name: "非车理赔共保总记录条数是否一致", type: "ROW_COUNT" },
  { code: "M202", name: "非车理赔共保业务键数量是否一致", type: "KEY_COUNT" },
  { code: "M203", name: "非车理赔共保理赔有、再保无", type: "MISSING_LEFT" },
  { code: "M204", name: "非车理赔共保再保有、理赔无", type: "MISSING_RIGHT" },
  { code: "M205", name: "非车理赔共保同一业务键下记录条数是否一致", type: "RECORD_COUNT_PER_KEY" },
  { code: "M206", name: "非车理赔共保理赔侧业务键是否重复", type: "DUPLICATE_LEFT" },
  { code: "M207", name: "非车理赔共保再保侧业务键是否重复", type: "DUPLICATE_RIGHT" },
  {
    code: "M208",
    name: "非车理赔共保未决类金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: ["coins_outst_amnt", "coins_fee_outst_amnt"]
  },
  {
    code: "M209",
    name: "非车理赔共保已决类金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: ["coins_this_settl_amnt", "coins_fee_settl_amnt"]
  }
];

const CLM_CVRG_METRICS: MetricConfig[] = [
  {
    code: "M301",
    name: "同一维度下标的险别赔款及费用金额是否一致",
    type: "AMOUNT_FIELDS",
    fields: [
      "cvrg_outst_amnt",
      "cvrg_this_settl_amnt",
      "cvrg_rmb_outst_amnt",
      "cvrg_rmb_this_settl_amnt",
      "fee_outst_amnt",
      "fee_this_settl_amnt",
      "fee_rmb_outst_amnt",
      "fee_rmb_this_settl_amnt"
    ]
  },
  { code: "M302", name: "标的险别理赔有、再保无", type: "MISSING_LEFT" },
  { code: "M303", name: "标的险别再保有、理赔无", type: "MISSING_RIGHT" }
];

const CLM_FAC_METRICS: MetricConfig[] = [
  ...CLM_METRICS.filter((metric) => metric.code !== "M008"),
  {
    code: "M008",
    name: "再保侧同业务键业务来源不是4000000",
    type: "SOURCE_ANOMALY",
    side: "RIGHT",
    sourceAnomaly: { mode: "NOT_IN", field: "bsns_src", allowed: ["4000000"] }
  }
];

export const PACK_SEEDS: PackSeed[] = [
  {
    packCode: "RP_RI",
    packName: "再保送收付↔收付账单",
    checkStage: "INTERFACE",
    pairCode: "RI_RP",
    description: "对齐 reinsure_rp_reconciliation_checks.sql：M001 条数、M002 金额、M003 遗漏/多出",
    sourceScripts: [
      "../自动对账指标/收付与再保/reinsure_rp_reconciliation_checks_summary.sql",
      "../自动对账指标/收付与再保/reinsure_rp_reconciliation_checks_diff_detail.sql"
    ],
    config: {
      comparisons: [
        {
          code: "RP_RECON",
          name: "再保送收付 ↔ 收付再保账单",
          leftDataset: ["RI_ACC_FAC_IN", "RI_ACC_TRTY_IN", "RI_ACC_XOL_TRTY_IN"],
          rightDataset: "RP_RI_BILL",
          keyFields: [
            "rp_batch_no",
            "dept_code",
            "bill_period",
            "trty_no",
            "bill_type",
            "prtc_mark",
            "bill_currency",
            "item_code"
          ],
          normalize: {
            upper: ["trty_no", "bill_type", "bill_currency", "item_code"]
          },
          leftRules: [
            {
              when: { cav_flag: { in: ["C"] } },
              negate: ["item_amnt", "item_rmb_amnt"]
            }
          ],
          filters: [{ side: "LEFT", field: "fee_code", notIn: ["20"] }],
          metrics: [
            { code: "M001", name: "特定时间段转入明细条数是否一致", type: "ROW_COUNT" },
            {
              code: "M002",
              name: "每条记录对应金额是否一致",
              type: "AMOUNT_FIELDS",
              fields: ["item_amnt", "item_rmb_amnt"],
              tolerance: { abs: "0.00" }
            },
            { code: "M003", name: "是否遗漏记录 / 是否多出记录", type: "MISSING_BOTH" }
          ]
        }
      ]
    }
  },
  {
    packCode: "UW_RI_FAC",
    packName: "临分分入承保↔再保",
    checkStage: "INTERFACE",
    pairCode: "NB_UW_RI",
    description: "对齐自动对账-临分分入承保与再保核对指标：M001-M008、M101-M103",
    sourceScripts: [
      "../自动对账指标/承保与再保/自动对账-临分分入承保与再保核对指标汇总.sql"
    ],
    config: {
      comparisons: [
        {
          code: "UW_FAC",
          name: "临分分入承保 ↔ 再保承保接口",
          leftDataset: "IFAC_PLCY",
          rightDataset: "RI_INTF_PLCY",
          keyFields: [
            "appl_no",
            "plcy_no",
            "endr_no",
            "endr_tms",
            "kind_no",
            "prod_no",
            "dept_code",
            "bsns_src",
            "amnt_cur",
            "prem_cur"
          ],
          normalize: {
            upper: ["appl_no", "plcy_no", "endr_no", "kind_no", "prod_no", "dept_code", "cur"]
          },
          filters: [
            { side: "LEFT", field: "bsns_src", equals: "4000000" },
            { side: "LEFT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "bsns_src", equals: "4000000" },
            { side: "RIGHT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "rbk_seq", equals: "0" }
          ],
          rightRules: [
            {
              when: { biz_type: { equals: "A" } },
              setZero: [
                "amnt_var",
                "rmb_amnt_var",
                "prem_var",
                "notax_prem_var",
                "rmb_prem_var",
                "rmb_notax_prem_var",
                "vat_amnt_var",
                "rmb_vat_amnt_var"
              ]
            }
          ],
          metrics: [...UW_METRICS]
        }
      ]
    }
  },
  {
    packCode: "CLM_RI_MAIN",
    packName: "常规理赔↔再保",
    checkStage: "INTERFACE",
    pairCode: "NB_CLM_RI",
    description: "对齐自动对账-再保理赔核对指标：M001-M008、M101、M102、M109",
    sourceScripts: [
      "../自动对账指标/理赔与再保/自动对账-再保理赔核对指标汇总.sql"
    ],
    config: {
      comparisons: [
        {
          code: "CLM_MAIN",
          name: "理赔未决主表 ↔ 再保理赔接口",
          leftDataset: "CLM_OUTST",
          rightDataset: "RI_INTF_CLM_OUTST",
          keyFields: ["rgst_no", "outst_tms", "plcy_no", "prod_no", "currency"],
          normalize: {
            upper: ["rgst_no", "plcy_no", "prod_no", "currency"]
          },
          filters: [
            { side: "LEFT", field: "extract_outst_flag", equals: "1" },
            { side: "LEFT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "rbk_seq", equals: "0" },
            { side: "RIGHT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "inwd_mark", notIn: ["1"] }
          ],
          rightRules: [
            {
              when: { claim_type: { in: ["4"] } },
              swapNegate: [
                ["outst_amnt", "this_settl_amnt"],
                ["rmb_outst_amnt", "rmb_this_settl_amnt"]
              ]
            }
          ],
          zeroSkip: {
            fields: [
              "outst_amnt",
              "fee_outst_amnt",
              "this_settl_amnt",
              "this_fee_settl_amnt",
              "rmb_outst_amnt",
              "rmb_fee_outst_amnt",
              "rmb_this_settl_amnt",
              "rmb_this_fee_settl_amnt"
            ],
            exceptions: [
              {
                side: "LEFT",
                field: "source",
                in: ["190", "902", "952", "953", "959", "931"]
              },
              {
                side: "RIGHT",
                field: "claim_type",
                in: ["0", "5", "7", "8"]
              }
            ]
          },
          metrics: [...CLM_METRICS]
        }
      ]
    }
  },
  {
    packCode: "CLM_RI_COINS",
    packName: "非车共保↔再保",
    checkStage: "INTERFACE",
    pairCode: "NB_CLM_RI",
    description: "对齐自动对账-再保理赔核对指标共保组 M201-M209",
    sourceScripts: [
      "../自动对账指标/理赔与再保/自动对账-再保理赔核对指标汇总.sql"
    ],
    config: {
      comparisons: [
        {
          code: "COINS",
          name: "非车理赔共保 ↔ 再保共保接口",
          leftDataset: "CLM_OUTST_COINS",
          rightDataset: "RI_INTF_CLM_COINS",
          keyFields: [
            "rgst_no",
            "outst_tms",
            "plcy_no",
            "prod_no",
            "bsns_src",
            "currency",
            "coins_code"
          ],
          normalize: {
            upper: ["rgst_no", "plcy_no", "prod_no", "currency", "coins_code", "bsns_src"]
          },
          filters: [
            { side: "LEFT", field: "extract_outst_flag", equals: "1" },
            { side: "LEFT", field: "migrate_flag", notIn: ["1"] },
            { side: "LEFT", field: "sys_code", in: ["CPROP", "CHTAC"] },
            { side: "RIGHT", field: "rbk_seq", equals: "0" },
            { side: "RIGHT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "inwd_mark", notIn: ["1"] }
          ],
          rightRules: [
            {
              when: { claim_type: { in: ["4"] } },
              swapNegate: [["coins_outst_amnt", "coins_this_settl_amnt"]]
            }
          ],
          metrics: [...CLM_COINS_METRICS]
        }
      ]
    }
  },
  {
    packCode: "CLM_RI_FAC",
    packName: "临分分入理赔↔再保",
    checkStage: "INTERFACE",
    pairCode: "NB_CLM_RI",
    description: "对齐自动对账-临分分入理赔与再保核对指标 M001-M008、M101、M102、M109",
    sourceScripts: [
      "../自动对账指标/理赔与再保/自动对账-临分分入理赔与再保核对指标汇总.sql"
    ],
    config: {
      comparisons: [
        {
          code: "CLM_FAC",
          name: "临分分入理赔 ↔ 再保理赔接口",
          leftDataset: "IFAC_CLM_OUTST",
          rightDataset: "RI_INTF_CLM_OUTST_FAC",
          keyFields: [
            "rgst_no",
            "outst_tms",
            "plcy_no",
            "endr_tms",
            "kind_no",
            "prod_no",
            "dept_code",
            "bsns_src",
            "currency"
          ],
          normalize: {
            upper: [
              "rgst_no",
              "plcy_no",
              "kind_no",
              "prod_no",
              "dept_code",
              "currency",
              "bsns_src"
            ]
          },
          filters: [
            { side: "LEFT", field: "bsns_src", equals: "4000000" },
            { side: "LEFT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "bsns_src", equals: "4000000" },
            { side: "RIGHT", field: "rbk_seq", equals: "0" },
            { side: "RIGHT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "inwd_mark", notIn: ["1"] }
          ],
          rightRules: [
            {
              when: { claim_type: { in: ["4"] } },
              swapNegate: [
                ["outst_amnt", "this_settl_amnt"],
                ["rmb_outst_amnt", "rmb_this_settl_amnt"]
              ]
            }
          ],
          metrics: [...CLM_FAC_METRICS]
        }
      ]
    }
  },
  {
    packCode: "CLM_RI_CVRG",
    packName: "险别赔款/费用↔再保",
    checkStage: "INTERFACE",
    pairCode: "NB_CLM_RI",
    description: "对齐自动对账-再保理赔险别核对指标 M301-M303",
    sourceScripts: [
      "../自动对账指标/理赔与再保/自动对账-再保理赔险别核对指标汇总.sql"
    ],
    config: {
      comparisons: [
        {
          code: "CVRG",
          name: "理赔险别赔款/费用 ↔ 再保险别接口",
          leftDataset: "CLM_OUTST_DTL",
          rightDataset: "RI_INTF_CLM_CVRG_FEE",
          keyFields: [
            "rgst_no",
            "outst_tms",
            "plcy_no",
            "prod_no",
            "currency",
            "tgt_seq_no",
            "cvrg_no"
          ],
          normalize: {
            upper: ["rgst_no", "plcy_no", "prod_no", "currency", "cvrg_no"]
          },
          filters: [
            { side: "LEFT", field: "extract_outst_flag", equals: "1" },
            { side: "LEFT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "rbk_seq", equals: "0" },
            { side: "RIGHT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "inwd_mark", notIn: ["1"] }
          ],
          rightRules: [
            {
              when: { claim_type: { in: ["4"] } },
              swapNegate: [
                ["cvrg_outst_amnt", "cvrg_this_settl_amnt"],
                ["cvrg_rmb_outst_amnt", "cvrg_rmb_this_settl_amnt"]
              ]
            }
          ],
          zeroSkip: {
            fields: [
              "cvrg_outst_amnt",
              "cvrg_this_settl_amnt",
              "cvrg_rmb_outst_amnt",
              "cvrg_rmb_this_settl_amnt",
              "fee_outst_amnt",
              "fee_this_settl_amnt",
              "fee_rmb_outst_amnt",
              "fee_rmb_this_settl_amnt"
            ],
            exceptions: [
              {
                side: "LEFT",
                field: "source",
                in: ["190", "902", "952", "953", "959", "931"]
              },
              { side: "RIGHT", field: "claim_type", in: ["0", "5", "7", "8"] }
            ]
          },
          metrics: [...CLM_CVRG_METRICS]
        }
      ]
    }
  },
  {
    packCode: "NB_UW_CLM_GENERIC",
    packName: "非车承保↔非车理赔（通用指标）",
    checkStage: "INTERFACE",
    pairCode: "NB_UW_NB_CLM",
    description:
      "承保↔理赔首版通用指标：条数、业务键数、单边缺失、同键记录数、重复；金额字段与业务键后续按表结构细化",
    sourceScripts: [],
    config: {
      comparisons: [
        {
          code: "NB_UW_CLM",
          name: "非车承保保单 ↔ 非车理赔未决",
          leftDataset: "IFAC_PLCY",
          rightDataset: "CLM_OUTST",
          keyFields: ["plcy_no"],
          normalize: { upper: ["plcy_no"] },
          filters: [
            { side: "LEFT", field: "migrate_flag", notIn: ["1"] },
            { side: "RIGHT", field: "extract_outst_flag", equals: "1" },
            { side: "RIGHT", field: "migrate_flag", notIn: ["1"] }
          ],
          metrics: [
            { code: "M001", name: "时间段内总记录条数是否一致", type: "ROW_COUNT" },
            { code: "M002", name: "业务键数量是否一致", type: "KEY_COUNT" },
            { code: "M003", name: "承保有、理赔无", type: "MISSING_LEFT" },
            { code: "M004", name: "理赔有、承保无", type: "MISSING_RIGHT" },
            { code: "M005", name: "同一业务键下记录条数是否一致", type: "RECORD_COUNT_PER_KEY" },
            { code: "M006", name: "承保侧业务键是否重复", type: "DUPLICATE_LEFT" },
            { code: "M007", name: "理赔侧业务键是否重复", type: "DUPLICATE_RIGHT" }
          ]
        }
      ]
    }
  }
];

export const SYSTEM_SEEDS: SystemSeed[] = [
  {
    systemCode: "NB_UW",
    systemName: "非车承保",
    systemType: "UNDERWRITING",
    description: "非车承保系统（含临分分入承保/理赔数据）",
    sortOrder: 10
  },
  {
    systemCode: "NB_CLM",
    systemName: "非车理赔",
    systemType: "CLAIM",
    description: "非车理赔系统",
    sortOrder: 20
  },
  {
    systemCode: "AUTO_UW",
    systemName: "车承保",
    systemType: "UNDERWRITING",
    description: "车承保系统（待接入表结构）",
    sortOrder: 30
  },
  {
    systemCode: "AUTO_CLM",
    systemName: "车理赔",
    systemType: "CLAIM",
    description: "车理赔系统（待接入表结构）",
    sortOrder: 40
  },
  {
    systemCode: "RI",
    systemName: "再保",
    systemType: "REINSURANCE",
    description: "再保系统（承保/理赔接口、送收付）",
    sortOrder: 50
  },
  {
    systemCode: "RP",
    systemName: "收付",
    systemType: "RECEIVABLE_PAYABLE",
    description: "收付账单系统",
    sortOrder: 60
  }
];

/** 同一 MySQL 实例、不同 schema；schemaKey 与数据集 schemaKey 对应。 */
export const ENVIRONMENT_SYSTEM_SEEDS: EnvironmentSystemSeed[] = [
  {
    envCode: "TEST",
    systemCode: "NB_UW",
    schemaMap: { DEFAULT: "fpic_ifac_db", IFAC: "fpic_ifac_db" }
  },
  {
    envCode: "TEST",
    systemCode: "NB_CLM",
    schemaMap: { DEFAULT: "fpic_clm_db", CLM: "fpic_clm_db" }
  },
  {
    envCode: "TEST",
    systemCode: "AUTO_UW",
    schemaMap: { DEFAULT: "fpic_auto_uw_db" }
  },
  {
    envCode: "TEST",
    systemCode: "AUTO_CLM",
    schemaMap: { DEFAULT: "fpic_auto_clm_db" }
  },
  {
    envCode: "TEST",
    systemCode: "RI",
    schemaMap: {
      DEFAULT: "fpic_ri_risk_db",
      RISK: "fpic_ri_risk_db",
      ACC: "fpic_ri_acc_db"
    }
  },
  {
    envCode: "TEST",
    systemCode: "RP",
    schemaMap: { DEFAULT: "fpic_rp_db" }
  }
];

/** 测试环境连接信息来自 LEGACY_MYSQL_*；生产环境先占位，密码只存环境变量名。 */
export function buildEnvironmentSeeds(input: {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
}): EnvironmentSeed[] {
  return [
    {
      envCode: "TEST",
      envName: "测试环境",
      dbHost: input.host ?? "127.0.0.1",
      dbPort: input.port ?? 3306,
      dbUser: input.user ?? "root",
      dbPasswordEnvKey: "LEGACY_MYSQL_PASSWORD",
      defaultDatabase: input.database ?? "",
      isDefault: true,
      description: "新核心测试环境（同一 MySQL 实例，按系统分 schema）"
    },
    {
      envCode: "PROD",
      envName: "生产环境",
      dbHost: "",
      dbPort: 3306,
      dbUser: "",
      dbPasswordEnvKey: "PROD_MYSQL_PASSWORD",
      defaultDatabase: "",
      isDefault: false,
      description: "生产环境占位：请在环境配置中填写连接信息，密码通过 PROD_MYSQL_PASSWORD 注入"
    }
  ];
}

export const PAIR_SEEDS: PairSeed[] = [
  {
    pairCode: "NB_UW_NB_CLM",
    pairName: "非车承保↔非车理赔",
    leftSystemCode: "NB_UW",
    rightSystemCode: "NB_CLM",
    description: "保单/批单与立案未决按保单号核对（通用指标，待细化）",
    sortOrder: 10
  },
  {
    pairCode: "AUTO_UW_AUTO_CLM",
    pairName: "车承保↔车理赔",
    leftSystemCode: "AUTO_UW",
    rightSystemCode: "AUTO_CLM",
    description: "待车险表结构接入后配置指标包",
    sortOrder: 20
  },
  {
    pairCode: "AUTO_UW_RI",
    pairName: "车承保↔再保",
    leftSystemCode: "AUTO_UW",
    rightSystemCode: "RI",
    description: "待车险表结构接入后配置指标包",
    sortOrder: 30
  },
  {
    pairCode: "NB_UW_RI",
    pairName: "非车承保↔再保",
    leftSystemCode: "NB_UW",
    rightSystemCode: "RI",
    description: "临分分入承保与再保承保接口核对",
    sortOrder: 40
  },
  {
    pairCode: "NB_CLM_RI",
    pairName: "非车理赔↔再保",
    leftSystemCode: "NB_CLM",
    rightSystemCode: "RI",
    description: "理赔主表/共保/临分/险别与再保理赔接口核对",
    sortOrder: 50
  },
  {
    pairCode: "AUTO_CLM_RI",
    pairName: "车理赔↔再保",
    leftSystemCode: "AUTO_CLM",
    rightSystemCode: "RI",
    description: "待车险表结构接入后配置指标包",
    sortOrder: 60
  },
  {
    pairCode: "RI_RP",
    pairName: "再保↔收付",
    leftSystemCode: "RI",
    rightSystemCode: "RP",
    description: "再保送收付与收付账单核对",
    sortOrder: 70
  }
];
