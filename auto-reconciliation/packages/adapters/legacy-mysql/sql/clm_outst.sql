-- 理赔未决主表（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：立案时间
SELECT
    t.n_pk_id AS c_pk_id,
    t.c_rgst_no,
    t.n_outst_tms,
    t.c_plcy_no,
    t.c_prod_no,
    t.c_extract_currency,
    t.c_extract_outst_flag,
    t.c_migrate_flag,
    t.c_source,
    t.c_sys_code,
    t.d_outst_time,
    COALESCE(t.n_this_outst_amnt, 0) AS n_this_outst_amnt,
    COALESCE(t.n_this_fee_outst_amnt, 0) AS n_this_fee_outst_amnt,
    COALESCE(t.n_this_settl_amnt, 0) AS n_this_settl_amnt,
    COALESCE(t.n_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
    COALESCE(t.n_e_this_outst_amnt, 0) AS n_e_this_outst_amnt,
    COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_e_this_fee_outst_amnt,
    COALESCE(t.n_e_this_settl_amnt, 0) AS n_e_this_settl_amnt,
    COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_e_this_fee_settl_amnt,
    ROUND(COALESCE(t.n_extract_rmb_exch, 0), 4) AS n_extract_rmb_exch
FROM {{schema}}.tb_clm_outst t
WHERE t.d_outst_time >= ?
  AND t.d_outst_time <  ?
  AND t.c_extract_outst_flag = '1'
  AND COALESCE(t.c_migrate_flag, '0') <> '1'
