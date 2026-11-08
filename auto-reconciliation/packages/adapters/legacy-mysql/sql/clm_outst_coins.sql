-- 理赔共保明细（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：立案时间
SELECT
    CONCAT(CAST(t.n_pk_id AS CHAR), ':', CAST(c.n_pk_id AS CHAR)) AS c_pk_id,
    t.c_rgst_no,
    t.n_outst_tms,
    t.c_plcy_no,
    t.c_prod_no,
    CAST('' AS CHAR(1)) AS c_bsns_src,
    t.c_extract_currency,
    c.c_coins_code,
    t.c_sys_code,
    t.c_extract_outst_flag,
    t.c_migrate_flag,
    t.d_outst_time,
    COALESCE(c.n_this_outst_amnt, 0) AS n_coins_outst_amnt,
    COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
    COALESCE(c.n_this_settl_amnt, 0) AS n_coins_this_settl_amnt,
    COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
FROM {{schema}}.tb_clm_outst t
JOIN {{schema}}.tb_clm_outst_coins c
  ON c.n_prt_id = t.n_pk_id
WHERE t.d_outst_time >= ?
  AND t.d_outst_time <  ?
  AND t.c_extract_outst_flag = '1'
  AND COALESCE(t.c_migrate_flag, '0') <> '1'
  AND UPPER(TRIM(t.c_sys_code)) IN ('CPROP', 'CHTAC')
  AND c.c_coins_code IS NOT NULL
