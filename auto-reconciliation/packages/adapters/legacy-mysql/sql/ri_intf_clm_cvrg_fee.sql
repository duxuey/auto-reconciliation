-- 再保理赔险别赔款/费用（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：理赔接口生成时间
SELECT
    CONCAT('C:', t.c_rgst_no, ':', CAST(s.n_pk_id AS CHAR)) AS c_pk_id,
    t.c_rgst_no,
    t.n_orig_outst_tms,
    t.c_plcy_no,
    t.c_prod_no,
    t.c_clm_cur,
    s.n_orig_tgt_seq_no,
    s.c_cvrg_no,
    t.c_claim_type,
    t.n_rbk_seq,
    t.c_migrate_flag,
    t.c_inwd_mark,
    t.d_clm_generate_time,
    COALESCE(s.n_outst_amnt, 0) AS cvrg_outst_amnt,
    COALESCE(s.n_this_settl_amnt, 0) AS cvrg_this_settl_amnt,
    COALESCE(s.n_rmb_outst_amnt, 0) AS cvrg_rmb_outst_amnt,
    COALESCE(s.n_rmb_this_settl_amnt, 0) AS cvrg_rmb_this_settl_amnt,
    0 AS fee_outst_amnt,
    0 AS fee_this_settl_amnt,
    0 AS fee_rmb_outst_amnt,
    0 AS fee_rmb_this_settl_amnt
FROM {{schema}}.tb_ri_intf_clm_outst t
JOIN {{schema}}.tb_ri_intf_clm_outst_cvrg s
  ON t.c_rgst_no = s.c_rgst_no
 AND t.n_orig_outst_tms = s.n_orig_outst_tms
 AND t.n_outst_tms = s.n_outst_tms
 AND t.n_rbk_seq = s.n_rbk_seq
WHERE t.d_clm_generate_time >= ?
  AND t.d_clm_generate_time <  ?
  AND t.n_rbk_seq = 0
  AND COALESCE(t.c_migrate_flag, '0') <> '1'
  AND COALESCE(t.c_inwd_mark, 0) <> 1

UNION ALL

SELECT
    CONCAT('F:', t.c_rgst_no, ':', CAST(s.n_pk_id AS CHAR)) AS c_pk_id,
    t.c_rgst_no,
    t.n_orig_outst_tms,
    t.c_plcy_no,
    t.c_prod_no,
    t.c_clm_cur,
    s.n_orig_tgt_seq_no,
    s.c_cvrg_no,
    t.c_claim_type,
    t.n_rbk_seq,
    t.c_migrate_flag,
    t.c_inwd_mark,
    t.d_clm_generate_time,
    0 AS cvrg_outst_amnt,
    0 AS cvrg_this_settl_amnt,
    0 AS cvrg_rmb_outst_amnt,
    0 AS cvrg_rmb_this_settl_amnt,
    COALESCE(s.n_fee_outst_amnt, 0) AS fee_outst_amnt,
    COALESCE(s.n_this_fee_settl_amnt, 0) AS fee_this_settl_amnt,
    COALESCE(s.n_rmb_fee_outst_amnt, 0) AS fee_rmb_outst_amnt,
    COALESCE(s.n_rmb_this_fee_settl_amnt, 0) AS fee_rmb_this_settl_amnt
FROM {{schema}}.tb_ri_intf_clm_outst t
JOIN {{schema}}.tb_ri_intf_clm_outst_fee s
  ON t.c_rgst_no = s.c_rgst_no
 AND t.n_orig_outst_tms = s.n_orig_outst_tms
 AND t.n_outst_tms = s.n_outst_tms
 AND t.n_rbk_seq = s.n_rbk_seq
WHERE t.d_clm_generate_time >= ?
  AND t.d_clm_generate_time <  ?
  AND t.n_rbk_seq = 0
  AND COALESCE(t.c_migrate_flag, '0') <> '1'
  AND COALESCE(t.c_inwd_mark, 0) <> 1
