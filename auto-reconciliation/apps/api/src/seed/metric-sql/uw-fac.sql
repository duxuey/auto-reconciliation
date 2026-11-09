/*
  自动对账-临分分入承保与再保核对指标.sql

  说明：
  1. 本脚本用于临分分入承保数据与再保接口数据核对，不使用临时表。
  2. 默认两侧核对区间一致：[2026-01-01 00:00:00, 2026-02-01 00:00:00)。
  3. 如需调整区间，请修改下方 params 的 ifac_begin_time / ifac_end_time / ri_begin_time / ri_end_time。
  4. 临分分入承保侧业务来源固定为 4000000，再保侧主核对范围限定 c_bsns_src = 4000000。
  5. 金额容差 amt_tol 默认为 0。
  6. 明细类指标查出数据即为不通过；金额类指标按差异项逐行输出业务维度、差异项、临分分入承保金额、再保金额和差异金额；查不出数据即为该指标通过。

  指标：
      M001 时间段内总记录条数是否一致
      M002 业务键数量是否一致
      M003 临分分入承保有、再保无
      M004 再保有、临分分入承保无
      M005 同一业务键下记录条数是否一致
      M006 临分分入承保侧业务键是否重复
      M007 再保侧业务键是否重复
      M008 再保侧同业务键业务来源不是4000000
      M101 保额类金额是否一致
      M102 保费类金额是否一致
      M103 税额类金额是否一致
*/

WITH
params AS (
    SELECT
        CAST('2026-01-01 00:00:00' AS DATETIME) AS ifac_begin_time,
        CAST('2026-02-01 00:00:00' AS DATETIME) AS ifac_end_time,
        CAST('2026-01-01 00:00:00' AS DATETIME) AS ri_begin_time,
        CAST('2026-02-01 00:00:00' AS DATETIME) AS ri_end_time,
        CAST('4000000' AS CHAR) AS target_bsns_src,
        CAST(0 AS DECIMAL(18, 6)) AS amt_tol
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(p.c_appl_no), '') AS c_appl_no,
        NULLIF(TRIM(p.c_plcy_no), '') AS c_plcy_no,
        NULLIF(TRIM(p.c_endr_no), '') AS c_endr_no,
        COALESCE(m.n_endr_tms, p.n_endr_tms) AS n_endr_tms,
        NULLIF(TRIM(m.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(m.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(m.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(p.c_orig_cur), '') AS c_amnt_cur,
        NULLIF(TRIM(p.c_sign_currency), '') AS c_prem_cur,

        COALESCE(p.n_self_sign_amnt, 0)          AS n_amnt,
        COALESCE(p.n_self_sign_amnt_var, 0)      AS n_amnt_var,
        COALESCE(p.n_self_rmb_amnt, 0)           AS n_rmb_amnt,
        COALESCE(p.n_self_rmb_amnt_var, 0)       AS n_rmb_amnt_var,

        COALESCE(p.n_self_sign_prem, 0)          AS n_prem,
        COALESCE(p.n_self_sign_prem_var, 0)      AS n_prem_var,
        COALESCE(p.n_self_sign_notax_prem, 0)    AS n_notax_prem,
        COALESCE(p.n_self_sign_notax_prem_var, 0) AS n_notax_prem_var,
        COALESCE(p.n_self_rmb_prem, 0)           AS n_rmb_prem,
        COALESCE(p.n_self_rmb_prem_var, 0)       AS n_rmb_prem_var,
        COALESCE(p.n_self_rmb_notax_prem, 0)     AS n_rmb_notax_prem,
        COALESCE(p.n_self_rmb_notax_prem_var, 0) AS n_rmb_notax_prem_var,

        COALESCE(p.n_self_sign_vat_amnt, 0)      AS n_vat_amnt,
        COALESCE(p.n_self_sign_vat_amnt_var, 0)  AS n_vat_amnt_var,
        COALESCE(p.n_self_rmb_vat_amnt, 0)       AS n_rmb_vat_amnt,
        COALESCE(p.n_self_rmb_vat_amnt_var, 0)   AS n_rmb_vat_amnt_var
    FROM fpic_ifac_db.tb_ifac_plcy_inwd_info p
    JOIN fpic_ifac_db.tb_ifac_plcy_main m
      ON p.c_appl_no = m.c_appl_no
    CROSS JOIN params prm
    WHERE m.d_undr_qual_time >= prm.ifac_begin_time
      AND m.d_undr_qual_time <  prm.ifac_end_time
      AND COALESCE(p.c_migrate_flag, '0') <> '1'
      AND COALESCE(m.c_migrate_flag, '0') <> '1'
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(p.c_appl_no), '') AS c_appl_no,
        NULLIF(TRIM(p.c_plcy_no), '') AS c_plcy_no,
        NULLIF(TRIM(p.c_endr_no), '') AS c_endr_no,
        p.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(p.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(p.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(p.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(p.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(p.c_amnt_cur), '') AS c_amnt_cur,
        NULLIF(TRIM(p.c_prem_cur), '') AS c_prem_cur,

        COALESCE(p.n_amnt, 0) AS n_amnt,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_amnt_var, 0) END AS n_amnt_var,
        COALESCE(p.n_rmb_amnt, 0) AS n_rmb_amnt,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_rmb_amnt_var, 0) END AS n_rmb_amnt_var,

        COALESCE(p.n_prem, 0) AS n_prem,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_prem_var, 0) END AS n_prem_var,
        COALESCE(p.n_notax_prem, 0) AS n_notax_prem,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_notax_prem_var, 0) END AS n_notax_prem_var,
        COALESCE(p.n_rmb_prem, 0) AS n_rmb_prem,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_rmb_prem_var, 0) END AS n_rmb_prem_var,
        COALESCE(p.n_rmb_notax_prem, 0) AS n_rmb_notax_prem,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_rmb_notax_prem_var, 0) END AS n_rmb_notax_prem_var,

        COALESCE(p.n_vat_amnt, 0) AS n_vat_amnt,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_vat_amnt_var, 0) END AS n_vat_amnt_var,
        COALESCE(p.n_rmb_vat_amnt, 0) AS n_rmb_vat_amnt,
        CASE WHEN p.c_biz_type = 'A' THEN 0 ELSE COALESCE(p.n_rmb_vat_amnt_var, 0) END AS n_rmb_vat_amnt_var
    FROM fpic_ri_risk_db.tb_ri_intf_plcy p
    CROSS JOIN params prm
    WHERE p.d_undr_qual_time >= prm.ri_begin_time
      AND p.d_undr_qual_time <  prm.ri_end_time
      AND p.n_rbk_seq = 0
      AND COALESCE(p.c_migrate_flag, '0') <> '1'
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        COUNT(*) AS record_cnt,
        SUM(n_amnt) AS n_amnt,
        SUM(n_amnt_var) AS n_amnt_var,
        SUM(n_rmb_amnt) AS n_rmb_amnt,
        SUM(n_rmb_amnt_var) AS n_rmb_amnt_var,
        SUM(n_prem) AS n_prem,
        SUM(n_prem_var) AS n_prem_var,
        SUM(n_notax_prem) AS n_notax_prem,
        SUM(n_notax_prem_var) AS n_notax_prem_var,
        SUM(n_rmb_prem) AS n_rmb_prem,
        SUM(n_rmb_prem_var) AS n_rmb_prem_var,
        SUM(n_rmb_notax_prem) AS n_rmb_notax_prem,
        SUM(n_rmb_notax_prem_var) AS n_rmb_notax_prem_var,
        SUM(n_vat_amnt) AS n_vat_amnt,
        SUM(n_vat_amnt_var) AS n_vat_amnt_var,
        SUM(n_rmb_vat_amnt) AS n_rmb_vat_amnt,
        SUM(n_rmb_vat_amnt_var) AS n_rmb_vat_amnt_var
    FROM ifac_std
    GROUP BY
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur
),

ri_key AS (
    SELECT
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        COUNT(*) AS record_cnt,
        SUM(n_amnt) AS n_amnt,
        SUM(n_amnt_var) AS n_amnt_var,
        SUM(n_rmb_amnt) AS n_rmb_amnt,
        SUM(n_rmb_amnt_var) AS n_rmb_amnt_var,
        SUM(n_prem) AS n_prem,
        SUM(n_prem_var) AS n_prem_var,
        SUM(n_notax_prem) AS n_notax_prem,
        SUM(n_notax_prem_var) AS n_notax_prem_var,
        SUM(n_rmb_prem) AS n_rmb_prem,
        SUM(n_rmb_prem_var) AS n_rmb_prem_var,
        SUM(n_rmb_notax_prem) AS n_rmb_notax_prem,
        SUM(n_rmb_notax_prem_var) AS n_rmb_notax_prem_var,
        SUM(n_vat_amnt) AS n_vat_amnt,
        SUM(n_vat_amnt_var) AS n_vat_amnt_var,
        SUM(n_rmb_vat_amnt) AS n_rmb_vat_amnt,
        SUM(n_rmb_vat_amnt_var) AS n_rmb_vat_amnt_var
    FROM ri_std
    GROUP BY
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur
),

ri_all_key AS (
    SELECT
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        COUNT(*) AS record_cnt
    FROM ri_all_std
    GROUP BY
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur
),

amt_cmp AS (
    SELECT
        c.c_appl_no,
        c.c_plcy_no,
        c.c_endr_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_amnt_cur,
        c.c_prem_cur,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_amnt AS ifac_n_amnt,
        r.n_amnt AS ri_n_amnt,
        r.n_amnt - c.n_amnt AS diff_n_amnt,
        c.n_amnt_var AS ifac_n_amnt_var,
        r.n_amnt_var AS ri_n_amnt_var,
        r.n_amnt_var - c.n_amnt_var AS diff_n_amnt_var,
        c.n_rmb_amnt AS ifac_n_rmb_amnt,
        r.n_rmb_amnt AS ri_n_rmb_amnt,
        r.n_rmb_amnt - c.n_rmb_amnt AS diff_n_rmb_amnt,
        c.n_rmb_amnt_var AS ifac_n_rmb_amnt_var,
        r.n_rmb_amnt_var AS ri_n_rmb_amnt_var,
        r.n_rmb_amnt_var - c.n_rmb_amnt_var AS diff_n_rmb_amnt_var,

        c.n_prem AS ifac_n_prem,
        r.n_prem AS ri_n_prem,
        r.n_prem - c.n_prem AS diff_n_prem,
        c.n_prem_var AS ifac_n_prem_var,
        r.n_prem_var AS ri_n_prem_var,
        r.n_prem_var - c.n_prem_var AS diff_n_prem_var,
        c.n_notax_prem AS ifac_n_notax_prem,
        r.n_notax_prem AS ri_n_notax_prem,
        r.n_notax_prem - c.n_notax_prem AS diff_n_notax_prem,
        c.n_notax_prem_var AS ifac_n_notax_prem_var,
        r.n_notax_prem_var AS ri_n_notax_prem_var,
        r.n_notax_prem_var - c.n_notax_prem_var AS diff_n_notax_prem_var,
        c.n_rmb_prem AS ifac_n_rmb_prem,
        r.n_rmb_prem AS ri_n_rmb_prem,
        r.n_rmb_prem - c.n_rmb_prem AS diff_n_rmb_prem,
        c.n_rmb_prem_var AS ifac_n_rmb_prem_var,
        r.n_rmb_prem_var AS ri_n_rmb_prem_var,
        r.n_rmb_prem_var - c.n_rmb_prem_var AS diff_n_rmb_prem_var,
        c.n_rmb_notax_prem AS ifac_n_rmb_notax_prem,
        r.n_rmb_notax_prem AS ri_n_rmb_notax_prem,
        r.n_rmb_notax_prem - c.n_rmb_notax_prem AS diff_n_rmb_notax_prem,
        c.n_rmb_notax_prem_var AS ifac_n_rmb_notax_prem_var,
        r.n_rmb_notax_prem_var AS ri_n_rmb_notax_prem_var,
        r.n_rmb_notax_prem_var - c.n_rmb_notax_prem_var AS diff_n_rmb_notax_prem_var,

        c.n_vat_amnt AS ifac_n_vat_amnt,
        r.n_vat_amnt AS ri_n_vat_amnt,
        r.n_vat_amnt - c.n_vat_amnt AS diff_n_vat_amnt,
        c.n_vat_amnt_var AS ifac_n_vat_amnt_var,
        r.n_vat_amnt_var AS ri_n_vat_amnt_var,
        r.n_vat_amnt_var - c.n_vat_amnt_var AS diff_n_vat_amnt_var,
        c.n_rmb_vat_amnt AS ifac_n_rmb_vat_amnt,
        r.n_rmb_vat_amnt AS ri_n_rmb_vat_amnt,
        r.n_rmb_vat_amnt - c.n_rmb_vat_amnt AS diff_n_rmb_vat_amnt,
        c.n_rmb_vat_amnt_var AS ifac_n_rmb_vat_amnt_var,
        r.n_rmb_vat_amnt_var AS ri_n_rmb_vat_amnt_var,
        r.n_rmb_vat_amnt_var - c.n_rmb_vat_amnt_var AS diff_n_rmb_vat_amnt_var
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_appl_no   <=> r.c_appl_no
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.c_endr_no   <=> r.c_endr_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_amnt_cur  <=> r.c_amnt_cur
     AND c.c_prem_cur  <=> r.c_prem_cur
),

ri_non_target_same_key AS (
    SELECT r.*
    FROM ri_all_key r
    CROSS JOIN params prm
    WHERE NOT (r.c_bsns_src <=> prm.target_bsns_src)
      AND EXISTS (
          SELECT 1
          FROM ifac_key c
          WHERE c.c_appl_no   <=> r.c_appl_no
            AND c.c_plcy_no   <=> r.c_plcy_no
            AND c.c_endr_no   <=> r.c_endr_no
            AND c.n_endr_tms  <=> r.n_endr_tms
            AND c.c_kind_no   <=> r.c_kind_no
            AND c.c_prod_no   <=> r.c_prod_no
            AND c.c_dept_code <=> r.c_dept_code
            AND c.c_amnt_cur  <=> r.c_amnt_cur
            AND c.c_prem_cur  <=> r.c_prem_cur
      )
),

amt_diff_rows AS (
    SELECT 'M101' AS metric_code, '保额类金额是否一致' AS metric_name, '保险金额' AS diff_item,
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_amnt AS ifac_amount, ri_n_amnt AS ri_amount, diff_n_amnt AS diff_amount
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_amnt) > p.amt_tol
    UNION ALL
    SELECT 'M101', '保额类金额是否一致', '保险金额变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_amnt_var, ri_n_amnt_var, diff_n_amnt_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_amnt_var) > p.amt_tol
    UNION ALL
    SELECT 'M101', '保额类金额是否一致', '保险金额本位币',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_amnt, ri_n_rmb_amnt, diff_n_rmb_amnt
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_amnt) > p.amt_tol
    UNION ALL
    SELECT 'M101', '保额类金额是否一致', '保险金额本位币变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_amnt_var, ri_n_rmb_amnt_var, diff_n_rmb_amnt_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_amnt_var) > p.amt_tol

    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '保费',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_prem, ri_n_prem, diff_n_prem
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_prem) > p.amt_tol
    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '保费变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_prem_var, ri_n_prem_var, diff_n_prem_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_prem_var) > p.amt_tol
    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '不含税保费',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_notax_prem, ri_n_notax_prem, diff_n_notax_prem
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_notax_prem) > p.amt_tol
    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '不含税保费变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_notax_prem_var, ri_n_notax_prem_var, diff_n_notax_prem_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_notax_prem_var) > p.amt_tol
    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '保费本位币',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_prem, ri_n_rmb_prem, diff_n_rmb_prem
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_prem) > p.amt_tol
    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '保费本位币变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_prem_var, ri_n_rmb_prem_var, diff_n_rmb_prem_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_prem_var) > p.amt_tol
    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '不含税保费本位币',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_notax_prem, ri_n_rmb_notax_prem, diff_n_rmb_notax_prem
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_notax_prem) > p.amt_tol
    UNION ALL
    SELECT 'M102', '保费类金额是否一致', '不含税保费本位币变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_notax_prem_var, ri_n_rmb_notax_prem_var, diff_n_rmb_notax_prem_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_notax_prem_var) > p.amt_tol

    UNION ALL
    SELECT 'M103', '税额类金额是否一致', '税额',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_vat_amnt, ri_n_vat_amnt, diff_n_vat_amnt
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_vat_amnt) > p.amt_tol
    UNION ALL
    SELECT 'M103', '税额类金额是否一致', '税额变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_vat_amnt_var, ri_n_vat_amnt_var, diff_n_vat_amnt_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_vat_amnt_var) > p.amt_tol
    UNION ALL
    SELECT 'M103', '税额类金额是否一致', '税额本位币',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_vat_amnt, ri_n_rmb_vat_amnt, diff_n_rmb_vat_amnt
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_vat_amnt) > p.amt_tol
    UNION ALL
    SELECT 'M103', '税额类金额是否一致', '税额本位币变化量',
           c_appl_no, c_plcy_no, c_endr_no, n_endr_tms, c_kind_no, c_prod_no, c_dept_code, c_bsns_src, c_amnt_cur, c_prem_cur,
           ifac_record_cnt, ri_record_cnt, ifac_n_rmb_vat_amnt_var, ri_n_rmb_vat_amnt_var, diff_n_rmb_vat_amnt_var
    FROM amt_cmp CROSS JOIN params p WHERE ABS(diff_n_rmb_vat_amnt_var) > p.amt_tol
),

metric_detail AS (
    SELECT
        'M001' AS metric_code,
        '时间段内总记录条数是否一致' AS metric_name,
        '数量差异' AS diff_type,
        CAST(NULL AS CHAR) AS c_appl_no,
        CAST(NULL AS CHAR) AS c_plcy_no,
        CAST(NULL AS CHAR) AS c_endr_no,
        CAST(NULL AS SIGNED) AS n_endr_tms,
        CAST(NULL AS CHAR) AS c_kind_no,
        CAST(NULL AS CHAR) AS c_prod_no,
        CAST(NULL AS CHAR) AS c_dept_code,
        CAST(NULL AS CHAR) AS c_bsns_src,
        CAST(NULL AS CHAR) AS c_amnt_cur,
        CAST(NULL AS CHAR) AS c_prem_cur,
        '总记录条数' AS diff_item,
        c.cnt AS ifac_record_cnt,
        r.cnt AS ri_record_cnt,
        CAST(NULL AS DECIMAL(20, 2)) AS ifac_amount,
        CAST(NULL AS DECIMAL(20, 2)) AS ri_amount,
        CAST(r.cnt - c.cnt AS DECIMAL(20, 2)) AS diff_amount,
        '同一时间段两侧原始记录数不一致' AS remark
    FROM (SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM ifac_std) c
    CROSS JOIN (SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM ri_std) r
    WHERE c.cnt <> r.cnt

    UNION ALL
    SELECT
        'M002',
        '业务键数量是否一致',
        '数量差异',
        CAST(NULL AS CHAR),
        CAST(NULL AS CHAR),
        CAST(NULL AS CHAR),
        CAST(NULL AS SIGNED),
        CAST(NULL AS CHAR),
        CAST(NULL AS CHAR),
        CAST(NULL AS CHAR),
        CAST(NULL AS CHAR),
        CAST(NULL AS CHAR),
        CAST(NULL AS CHAR),
        '业务键数量',
        c.cnt,
        r.cnt,
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(r.cnt - c.cnt AS DECIMAL(20, 2)),
        '同一时间段两侧聚合后业务键数量不一致'
    FROM (SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM ifac_key) c
    CROSS JOIN (SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM ri_key) r
    WHERE c.cnt <> r.cnt

    UNION ALL
    SELECT
        'M003',
        '临分分入承保有、再保无',
        '缺失差异',
        c.c_appl_no,
        c.c_plcy_no,
        c.c_endr_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_amnt_cur,
        c.c_prem_cur,
        '业务键',
        c.record_cnt,
        CAST(NULL AS SIGNED),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        '临分分入承保侧存在，再保侧不存在'
    FROM ifac_key c
    WHERE NOT EXISTS (
        SELECT 1
        FROM ri_key r
        WHERE c.c_appl_no   <=> r.c_appl_no
          AND c.c_plcy_no   <=> r.c_plcy_no
          AND c.c_endr_no   <=> r.c_endr_no
          AND c.n_endr_tms  <=> r.n_endr_tms
          AND c.c_kind_no   <=> r.c_kind_no
          AND c.c_prod_no   <=> r.c_prod_no
          AND c.c_dept_code <=> r.c_dept_code
          AND c.c_bsns_src  <=> r.c_bsns_src
          AND c.c_amnt_cur  <=> r.c_amnt_cur
          AND c.c_prem_cur  <=> r.c_prem_cur
    )

    UNION ALL
    SELECT
        'M004',
        '再保有、临分分入承保无',
        '缺失差异',
        r.c_appl_no,
        r.c_plcy_no,
        r.c_endr_no,
        r.n_endr_tms,
        r.c_kind_no,
        r.c_prod_no,
        r.c_dept_code,
        r.c_bsns_src,
        r.c_amnt_cur,
        r.c_prem_cur,
        '业务键',
        CAST(NULL AS SIGNED),
        r.record_cnt,
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        '再保侧存在，临分分入承保侧不存在'
    FROM ri_key r
    WHERE NOT EXISTS (
        SELECT 1
        FROM ifac_key c
        WHERE c.c_appl_no   <=> r.c_appl_no
          AND c.c_plcy_no   <=> r.c_plcy_no
          AND c.c_endr_no   <=> r.c_endr_no
          AND c.n_endr_tms  <=> r.n_endr_tms
          AND c.c_kind_no   <=> r.c_kind_no
          AND c.c_prod_no   <=> r.c_prod_no
          AND c.c_dept_code <=> r.c_dept_code
          AND c.c_bsns_src  <=> r.c_bsns_src
          AND c.c_amnt_cur  <=> r.c_amnt_cur
          AND c.c_prem_cur  <=> r.c_prem_cur
    )

    UNION ALL
    SELECT
        'M005',
        '同一业务键下记录条数是否一致',
        '数量差异',
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        '业务键记录数',
        ifac_record_cnt,
        ri_record_cnt,
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(ri_record_cnt - ifac_record_cnt AS DECIMAL(20, 2)),
        '同一业务键下两侧记录条数不一致'
    FROM amt_cmp
    WHERE ifac_record_cnt <> ri_record_cnt

    UNION ALL
    SELECT
        'M006',
        '临分分入承保侧业务键是否重复',
        '重复差异',
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        '业务键重复',
        record_cnt,
        CAST(NULL AS SIGNED),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        '临分分入承保侧同一业务键存在多条记录'
    FROM ifac_key
    WHERE record_cnt > 1

    UNION ALL
    SELECT
        'M007',
        '再保侧业务键是否重复',
        '重复差异',
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        '业务键重复',
        CAST(NULL AS SIGNED),
        record_cnt,
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        '再保侧同一业务键存在多条记录'
    FROM ri_key
    WHERE record_cnt > 1

    UNION ALL
    SELECT
        'M008',
        '再保侧同业务键业务来源不是4000000',
        '业务来源差异',
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        '业务来源',
        CAST(NULL AS SIGNED),
        record_cnt,
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        CAST(NULL AS DECIMAL(20, 2)),
        '再保侧存在同业务键但业务来源不是4000000'
    FROM ri_non_target_same_key

    UNION ALL
    SELECT
        metric_code,
        metric_name,
        '金额差异',
        c_appl_no,
        c_plcy_no,
        c_endr_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_amnt_cur,
        c_prem_cur,
        diff_item,
        ifac_record_cnt,
        ri_record_cnt,
        ifac_amount,
        ri_amount,
        diff_amount,
        '再保金额 - 临分分入承保金额 超过容差'
    FROM amt_diff_rows
)
SELECT
    metric_code,
    metric_name,
    '不通过' AS check_result,
    diff_type,
    c_appl_no,
    c_plcy_no,
    c_endr_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_amnt_cur,
    c_prem_cur,
    diff_item,
    ifac_record_cnt,
    ri_record_cnt,
    ifac_amount,
    ri_amount,
    diff_amount,
    remark
FROM metric_detail
ORDER BY
    CASE metric_code
        WHEN 'M001' THEN 1
        WHEN 'M002' THEN 2
        WHEN 'M003' THEN 3
        WHEN 'M004' THEN 4
        WHEN 'M005' THEN 5
        WHEN 'M006' THEN 6
        WHEN 'M007' THEN 7
        WHEN 'M008' THEN 8
        WHEN 'M101' THEN 9
        WHEN 'M102' THEN 10
        WHEN 'M103' THEN 11
        ELSE 999
    END,
    c_appl_no,
    c_plcy_no,
    c_endr_no,
    diff_item;
