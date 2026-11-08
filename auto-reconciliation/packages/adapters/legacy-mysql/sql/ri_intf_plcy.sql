-- 再保承保接口（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止；时间口径：核保通过时间
SELECT
    p.n_pk_id AS c_pk_id,
    p.c_appl_no,
    p.c_plcy_no,
    p.c_endr_no,
    p.n_endr_tms,
    p.c_kind_no,
    p.c_prod_no,
    p.c_dept_code,
    p.c_bsns_src,
    p.c_amnt_cur,
    p.c_prem_cur,
    p.c_migrate_flag,
    p.c_biz_type,
    p.n_rbk_seq,
    p.d_undr_qual_time,
    COALESCE(p.n_amnt, 0) AS n_amnt,
    COALESCE(p.n_amnt_var, 0) AS n_amnt_var,
    COALESCE(p.n_rmb_amnt, 0) AS n_rmb_amnt,
    COALESCE(p.n_rmb_amnt_var, 0) AS n_rmb_amnt_var,
    COALESCE(p.n_prem, 0) AS n_prem,
    COALESCE(p.n_prem_var, 0) AS n_prem_var,
    COALESCE(p.n_notax_prem, 0) AS n_notax_prem,
    COALESCE(p.n_notax_prem_var, 0) AS n_notax_prem_var,
    COALESCE(p.n_rmb_prem, 0) AS n_rmb_prem,
    COALESCE(p.n_rmb_prem_var, 0) AS n_rmb_prem_var,
    COALESCE(p.n_rmb_notax_prem, 0) AS n_rmb_notax_prem,
    COALESCE(p.n_rmb_notax_prem_var, 0) AS n_rmb_notax_prem_var,
    COALESCE(p.n_vat_amnt, 0) AS n_vat_amnt,
    COALESCE(p.n_vat_amnt_var, 0) AS n_vat_amnt_var,
    COALESCE(p.n_rmb_vat_amnt, 0) AS n_rmb_vat_amnt,
    COALESCE(p.n_rmb_vat_amnt_var, 0) AS n_rmb_vat_amnt_var
FROM {{schema}}.tb_ri_intf_plcy p
WHERE p.d_undr_qual_time >= ?
  AND p.d_undr_qual_time <  ?
  AND p.n_rbk_seq = 0
  AND COALESCE(p.c_migrate_flag, '0') <> '1'
