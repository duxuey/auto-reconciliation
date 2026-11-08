-- 临分分入理赔（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：立案时间
SELECT
    t.n_pk_id AS c_pk_id,
    t.c_rgst_no,
    t.n_outst_tms,
    t.c_plcy_no,
    pm.n_endr_tms,
    pm.c_kind_no,
    pm.c_prod_no,
    d.c_dept_code,
    CAST('4000000' AS CHAR(20)) AS c_bsns_src,
    d.c_clm_cur AS c_extract_currency,
    t.d_outst_time,
    COALESCE(t.n_e_sum_this_outst_amnt, 0) AS n_outst_amnt,
    COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
    COALESCE(t.n_e_sum_this_settl_amnt, 0) AS n_this_settl_amnt,
    COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
    COALESCE(t.n_this_outst_amnt, 0) AS n_rmb_outst_amnt,
    COALESCE(t.n_this_fee_outst_amnt, 0) AS n_rmb_fee_outst_amnt,
    COALESCE(t.n_this_settl_amnt, 0) AS n_rmb_this_settl_amnt,
    COALESCE(t.n_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
    ROUND(COALESCE(t.n_extract_rmb_exch, 0), 4) AS n_rmb_exch
FROM {{schema}}.tb_ifac_clm_outst_his t
LEFT JOIN {{schema}}.tb_ifac_clm_inwd_info d
  ON t.c_batch_no = d.c_batch_no
LEFT JOIN {{schema}}.tb_ifac_plcy_main pm
  ON pm.c_appl_no = d.c_appl_no
WHERE t.d_outst_time >= ?
  AND t.d_outst_time <  ?
