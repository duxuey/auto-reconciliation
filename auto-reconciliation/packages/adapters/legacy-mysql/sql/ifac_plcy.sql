-- 临分分入承保（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：核保通过时间
SELECT
    p.n_pk_id AS c_pk_id,
    p.c_appl_no,
    p.c_plcy_no,
    p.c_endr_no,
    COALESCE(m.n_endr_tms, p.n_endr_tms, 0) AS n_endr_tms,
    m.c_kind_no,
    m.c_prod_no,
    m.c_dept_code,
    CAST('4000000' AS CHAR(20)) AS c_bsns_src,
    p.c_orig_cur AS c_amnt_cur,
    p.c_sign_currency AS c_prem_cur,
    p.c_migrate_flag,
    m.d_undr_qual_time,
    COALESCE(p.n_self_sign_amnt, 0) AS n_amnt,
    COALESCE(p.n_self_sign_amnt_var, 0) AS n_amnt_var,
    COALESCE(p.n_self_rmb_amnt, 0) AS n_rmb_amnt,
    COALESCE(p.n_self_rmb_amnt_var, 0) AS n_rmb_amnt_var,
    COALESCE(p.n_self_sign_prem, 0) AS n_prem,
    COALESCE(p.n_self_sign_prem_var, 0) AS n_prem_var,
    COALESCE(p.n_self_sign_notax_prem, 0) AS n_notax_prem,
    COALESCE(p.n_self_sign_notax_prem_var, 0) AS n_notax_prem_var,
    COALESCE(p.n_self_rmb_prem, 0) AS n_rmb_prem,
    COALESCE(p.n_self_rmb_prem_var, 0) AS n_rmb_prem_var,
    COALESCE(p.n_self_rmb_notax_prem, 0) AS n_rmb_notax_prem,
    COALESCE(p.n_self_rmb_notax_prem_var, 0) AS n_rmb_notax_prem_var,
    COALESCE(p.n_self_sign_vat_amnt, 0) AS n_vat_amnt,
    COALESCE(p.n_self_sign_vat_amnt_var, 0) AS n_vat_amnt_var,
    COALESCE(p.n_self_rmb_vat_amnt, 0) AS n_rmb_vat_amnt,
    COALESCE(p.n_self_rmb_vat_amnt_var, 0) AS n_rmb_vat_amnt_var
FROM {{schema}}.tb_ifac_plcy_inwd_info p
JOIN {{schema}}.tb_ifac_plcy_main m
  ON p.c_appl_no = m.c_appl_no
WHERE m.d_undr_qual_time >= ?
  AND m.d_undr_qual_time <  ?
  AND COALESCE(p.c_migrate_flag, '0') <> '1'
  AND COALESCE(m.c_migrate_flag, '0') <> '1'
