-- 再保理赔接口（临分分入，只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：理赔接口生成时间
SELECT
    t.n_pk_id AS c_pk_id,
    t.c_rgst_no,
    t.n_orig_outst_tms,
    t.c_plcy_no,
    t.n_endr_tms,
    t.c_kind_no,
    t.c_prod_no,
    t.c_dept_code,
    t.c_bsns_src,
    t.c_clm_cur,
    t.c_claim_type,
    t.n_rbk_seq,
    t.c_migrate_flag,
    t.c_inwd_mark,
    t.d_clm_generate_time,
    COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
    COALESCE(t.n_fee_outst_amnt, 0) AS n_fee_outst_amnt,
    COALESCE(t.n_this_settl_amnt, 0) AS n_this_settl_amnt,
    COALESCE(t.n_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
    COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
    COALESCE(t.n_rmb_fee_outst_amnt, 0) AS n_rmb_fee_outst_amnt,
    COALESCE(t.n_rmb_this_settl_amnt, 0) AS n_rmb_this_settl_amnt,
    COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
    ROUND(COALESCE(t.n_rmb_clm_exch, 0), 4) AS n_rmb_clm_exch
FROM {{schema}}.tb_ri_intf_clm_outst t
WHERE t.d_clm_generate_time >= ?
  AND t.d_clm_generate_time <  ?
  AND t.n_rbk_seq = 0
  AND COALESCE(t.c_migrate_flag, '0') <> '1'
  AND COALESCE(t.c_inwd_mark, 0) <> 1
  AND CAST(t.c_bsns_src AS CHAR) = '4000000'
