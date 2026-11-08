-- 理赔险别赔款/费用（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：立案时间
SELECT
    CONCAT(CAST(t.n_pk_id AS CHAR), ':', CAST(d.n_pk_id AS CHAR)) AS c_pk_id,
    t.c_rgst_no,
    t.n_outst_tms,
    t.c_plcy_no,
    t.c_prod_no,
    t.c_extract_currency,
    d.n_tgt_seq_no,
    d.c_cvrg_no,
    t.c_extract_outst_flag,
    t.c_migrate_flag,
    t.c_source,
    t.d_outst_time,
    CASE WHEN TRIM(d.c_loss_category) = '00' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS cvrg_outst_amnt,
    CASE WHEN TRIM(d.c_loss_category) = '00' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS cvrg_this_settl_amnt,
    CASE WHEN TRIM(d.c_loss_category) = '00' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS cvrg_rmb_outst_amnt,
    CASE WHEN TRIM(d.c_loss_category) = '00' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS cvrg_rmb_this_settl_amnt,
    CASE WHEN TRIM(d.c_loss_category) = '999' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS fee_outst_amnt,
    CASE WHEN TRIM(d.c_loss_category) = '999' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS fee_this_settl_amnt,
    CASE WHEN TRIM(d.c_loss_category) = '999' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS fee_rmb_outst_amnt,
    CASE WHEN TRIM(d.c_loss_category) = '999' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS fee_rmb_this_settl_amnt
FROM {{schema}}.tb_clm_outst t
JOIN {{schema}}.tb_clm_outst_dtl d
  ON d.n_prt_id = t.n_pk_id
WHERE t.d_outst_time >= ?
  AND t.d_outst_time <  ?
  AND t.c_extract_outst_flag = '1'
  AND COALESCE(t.c_migrate_flag, '0') <> '1'
