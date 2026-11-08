-- 再保理赔共保接口（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：理赔接口生成时间
SELECT
    CONCAT(t.c_rgst_no, ':', CAST(s.n_pk_id AS CHAR)) AS c_pk_id,
    t.c_rgst_no,
    t.n_orig_outst_tms,
    t.c_plcy_no,
    t.c_prod_no,
    CAST('' AS CHAR(1)) AS c_bsns_src,
    t.c_clm_cur,
    s.c_coins_code,
    t.c_claim_type,
    t.n_rbk_seq,
    t.c_migrate_flag,
    t.c_inwd_mark,
    t.d_clm_generate_time,
    COALESCE(s.n_outst_amnt, 0) AS n_outst_amnt,
    COALESCE(s.n_fee_outst_amnt, 0) AS n_fee_outst_amnt,
    COALESCE(s.n_this_settl_amnt, 0) AS n_this_settl_amnt,
    COALESCE(s.n_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt
FROM {{schema}}.tb_ri_intf_clm_outst t
JOIN {{schema}}.tb_ri_intf_clm_outst_coins s
  ON t.c_rgst_no = s.c_rgst_no
 AND t.n_orig_outst_tms = s.n_orig_outst_tms
 AND t.n_outst_tms = s.n_outst_tms
 AND t.n_rbk_seq = s.n_rbk_seq
WHERE t.d_clm_generate_time >= ?
  AND t.d_clm_generate_time <  ?
  AND t.n_rbk_seq = 0
  AND COALESCE(t.c_migrate_flag, '0') <> '1'
  AND COALESCE(t.c_inwd_mark, 0) <> 1
  AND s.c_coins_code IS NOT NULL
