/*
  自动对账-临分分入理赔与再保核对指标.sql

  说明：
  1. 本脚本用于临分分入理赔数据与再保接口数据核对，不使用临时表。
  2. 每个指标均为一条完整的 CTE + SELECT；如需单独执行某个指标，请先执行下方“公共输入参数”。
  3. 默认临分分入理赔核对区间：[2026-01-01 00:00:00, 2026-01-31 23:59:59)。
  4. 默认再保接口核对区间：[2026-01-01 00:00:00, 2026-01-02 00:00:00)。
  5. 如需两侧使用同一时间段，请修改下方“公共输入参数”的 ifac_begin_time / ifac_end_time / ri_begin_time / ri_end_time。
  6. 金额容差 amt_tol 默认为 0。
  7. 临分分入理赔侧业务来源固定为 4000000，再保侧主核对范围限定 c_bsns_src = 4000000。
  8. 默认业务键：立案号 + 原未决调整次数 + 保单号 + 批改序号 + 险类代码 + 产品代码 + 机构代码 + 业务来源 + 币种。
  9. M008 额外检查：同业务键下，再保侧是否存在业务来源不是 4000000 的记录。
  10. 明细类指标查出数据即为不通过；金额类指标按差异项逐行输出业务维度、差异项、临分分入理赔金额、再保金额和差异金额；查不出数据即为该指标通过。
  11. 指标目录（共 11 个，按执行顺序）：
      M001 时间段内总记录条数是否一致
      M002 业务键数量是否一致
      M003 临分分入理赔有、再保无
      M004 再保有、临分分入理赔无
      M005 同一业务键下记录条数是否一致
      M006 临分分入理赔侧业务键是否重复
      M007 再保侧业务键是否重复
      M008 再保侧同业务键业务来源不是4000000
      M101 未决类金额是否一致
      M102 已决类金额是否一致
      M109 折人民币赔款兑换率是否一致
*/

/* =========================================================
   公共输入参数：全脚本统一维护，后续各指标共用
   ========================================================= */
SET @ifac_begin_time = CAST('2026-01-01 00:00:00' AS DATETIME);
SET @ifac_end_time   = CAST('2026-01-31 23:59:59' AS DATETIME);
SET @ri_begin_time   = CAST('2026-01-01 00:00:00' AS DATETIME);
SET @ri_end_time     = CAST('2026-01-02 00:00:00' AS DATETIME);
SET @target_bsns_src = CAST('4000000' AS CHAR);
SET @amt_tol         = CAST(0 AS DECIMAL(18, 6));
-- 可选：执行 source 前先 SET @exclude_rgst_no_prefix_5 = 1；不设置、置空或置 0 表示不过滤 c_rgst_no 以 5 开头的数据。

/* =========================================================
   指标 M001：时间段内总记录条数是否一致
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M001' AS metric_code,
    '时间段内总记录条数是否一致' AS metric_name,
    c.cnt AS ifac_count,
    r.cnt AS ri_count,
    r.cnt - c.cnt AS diff_count,
    CASE WHEN c.cnt = r.cnt THEN '通过' ELSE '不通过' END AS check_result
FROM (SELECT COUNT(*) AS cnt FROM ifac_std) c
CROSS JOIN (SELECT COUNT(*) AS cnt FROM ri_std) r;

/* =========================================================
   指标 M002：业务键数量是否一致
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M002' AS metric_code,
    '业务键数量是否一致' AS metric_name,
    c.cnt AS ifac_key_count,
    r.cnt AS ri_key_count,
    r.cnt - c.cnt AS diff_key_count,
    CASE WHEN c.cnt = r.cnt THEN '通过' ELSE '不通过' END AS check_result
FROM (SELECT COUNT(*) AS cnt FROM ifac_key) c
CROSS JOIN (SELECT COUNT(*) AS cnt FROM ri_key) r;

/* =========================================================
   指标 M003：临分分入理赔有、再保无
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M003' AS metric_code,
    '临分分入理赔有、再保无' AS metric_name,
    c.c_rgst_no,
    c.n_outst_tms,
    c.c_plcy_no,
    c.n_endr_tms,
    c.c_kind_no,
    c.c_prod_no,
    c.c_dept_code,
    c.c_bsns_src,
    c.c_currency,
    c.record_cnt,
    '不通过' AS check_result
FROM ifac_key c
WHERE NOT EXISTS (
    SELECT 1
    FROM ri_key r
    WHERE c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.n_endr_tms  <=> r.n_endr_tms
      AND c.c_kind_no   <=> r.c_kind_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_dept_code <=> r.c_dept_code
      AND c.c_bsns_src  <=> r.c_bsns_src
      AND c.c_currency  <=> r.c_currency
);

/* =========================================================
   指标 M004：再保有、临分分入理赔无
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M004' AS metric_code,
    '再保有、临分分入理赔无' AS metric_name,
    r.c_rgst_no,
    r.n_outst_tms,
    r.c_plcy_no,
    r.n_endr_tms,
    r.c_kind_no,
    r.c_prod_no,
    r.c_dept_code,
    r.c_bsns_src,
    r.c_currency,
    r.record_cnt,
    '不通过' AS check_result
FROM ri_key r
WHERE NOT EXISTS (
    SELECT 1
    FROM ifac_key c
    WHERE c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.n_endr_tms  <=> r.n_endr_tms
      AND c.c_kind_no   <=> r.c_kind_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_dept_code <=> r.c_dept_code
      AND c.c_bsns_src  <=> r.c_bsns_src
      AND c.c_currency  <=> r.c_currency
);

/* =========================================================
   指标 M005：同一业务键下记录条数是否一致
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M005' AS metric_code,
    '同一业务键下记录条数是否一致' AS metric_name,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_record_cnt,
    ri_record_cnt,
    ri_record_cnt - ifac_record_cnt AS diff_record_cnt,
    '不通过' AS check_result
FROM amt_cmp
WHERE ifac_record_cnt <> ri_record_cnt;

/* =========================================================
   指标 M006：临分分入理赔侧业务键是否重复
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M006' AS metric_code,
    '临分分入理赔侧业务键是否重复' AS metric_name,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    record_cnt,
    '不通过' AS check_result
FROM ifac_key
WHERE record_cnt > 1;

/* =========================================================
   指标 M007：再保侧业务键是否重复
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M007' AS metric_code,
    '再保侧业务键是否重复' AS metric_name,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    record_cnt,
    '不通过' AS check_result
FROM ri_key
WHERE record_cnt > 1;

/* =========================================================
   指标 M008：再保侧同业务键业务来源不是4000000
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M008' AS metric_code,
    '再保侧同业务键业务来源不是4000000' AS metric_name,
    r.c_rgst_no,
    r.n_outst_tms,
    r.c_plcy_no,
    r.n_endr_tms,
    r.c_kind_no,
    r.c_prod_no,
    r.c_dept_code,
    r.c_bsns_src AS ri_c_bsns_src,
    r.c_currency,
    r.record_cnt,
    '不通过' AS check_result
FROM ri_all_key r
CROSS JOIN params prm
WHERE NOT (r.c_bsns_src <=> prm.target_bsns_src)
  AND EXISTS (
      SELECT 1
      FROM ifac_key c
      WHERE c.c_rgst_no   <=> r.c_rgst_no
        AND c.n_outst_tms <=> r.n_outst_tms
        AND c.c_plcy_no   <=> r.c_plcy_no
        AND c.n_endr_tms  <=> r.n_endr_tms
        AND c.c_kind_no   <=> r.c_kind_no
        AND c.c_prod_no   <=> r.c_prod_no
        AND c.c_dept_code <=> r.c_dept_code
        AND c.c_currency  <=> r.c_currency
  );

/* =========================================================
   指标 M101：未决类金额是否一致
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M101' AS metric_code,
    '未决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '未决总金额' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_outst_amnt AS ifac_amount,
    ri_n_outst_amnt AS ri_amount,
    diff_n_outst_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_outst_amnt) > p.amt_tol
UNION ALL
SELECT
    'M101' AS metric_code,
    '未决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '费用总未决金额' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_fee_outst_amnt AS ifac_amount,
    ri_n_fee_outst_amnt AS ri_amount,
    diff_n_fee_outst_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_fee_outst_amnt) > p.amt_tol
UNION ALL
SELECT
    'M101' AS metric_code,
    '未决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '未决总金额(本位币)' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_rmb_outst_amnt AS ifac_amount,
    ri_n_rmb_outst_amnt AS ri_amount,
    diff_n_rmb_outst_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_rmb_outst_amnt) > p.amt_tol
UNION ALL
SELECT
    'M101' AS metric_code,
    '未决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '费用总未决金额(本位币)' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_rmb_fee_outst_amnt AS ifac_amount,
    ri_n_rmb_fee_outst_amnt AS ri_amount,
    diff_n_rmb_fee_outst_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_rmb_fee_outst_amnt) > p.amt_tol;

/* =========================================================
   指标 M102：已决类金额是否一致
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M102' AS metric_code,
    '已决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '本次赔款已决金额' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_this_settl_amnt AS ifac_amount,
    ri_n_this_settl_amnt AS ri_amount,
    diff_n_this_settl_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_this_settl_amnt) > p.amt_tol
UNION ALL
SELECT
    'M102' AS metric_code,
    '已决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '本次费用已决金额' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_this_fee_settl_amnt AS ifac_amount,
    ri_n_this_fee_settl_amnt AS ri_amount,
    diff_n_this_fee_settl_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_this_fee_settl_amnt) > p.amt_tol
UNION ALL
SELECT
    'M102' AS metric_code,
    '已决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '本次赔款已决金额(本位币)' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_rmb_this_settl_amnt AS ifac_amount,
    ri_n_rmb_this_settl_amnt AS ri_amount,
    diff_n_rmb_this_settl_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_rmb_this_settl_amnt) > p.amt_tol
UNION ALL
SELECT
    'M102' AS metric_code,
    '已决类金额是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '本次费用已决金额(本位币)' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_rmb_this_fee_settl_amnt AS ifac_amount,
    ri_n_rmb_this_fee_settl_amnt AS ri_amount,
    diff_n_rmb_this_fee_settl_amnt AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_rmb_this_fee_settl_amnt) > p.amt_tol;

/* =========================================================
   指标 M109：折人民币赔款兑换率是否一致
   ========================================================= */
WITH
params AS (
    SELECT
        @ifac_begin_time AS ifac_begin_time,
        @ifac_end_time AS ifac_end_time,
        @ri_begin_time AS ri_begin_time,
        @ri_end_time AS ri_end_time,
        @target_bsns_src AS target_bsns_src,
        @amt_tol AS amt_tol,
        CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
),

ifac_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        pm.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(pm.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(pm.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(d.c_dept_code), '') AS c_dept_code,
        prm.target_bsns_src AS c_bsns_src,
        NULLIF(TRIM(d.c_clm_cur), '') AS c_currency,

        COALESCE(t.n_e_sum_this_outst_amnt, 0)     AS n_outst_amnt,
        COALESCE(t.n_e_sum_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
        COALESCE(t.n_e_sum_this_settl_amnt, 0)     AS n_this_settl_amnt,
        COALESCE(t.n_e_sum_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,

        COALESCE(t.n_sum_outst_amnt, 0)            AS n_rmb_outst_amnt,
        COALESCE(t.n_sum_fee_outst_amnt, 0)        AS n_rmb_fee_outst_amnt,
        COALESCE(t.n_this_settl_amnt, 0)           AS n_rmb_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)       AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_extract_rmb_exch, 0)          AS n_rmb_exch
    FROM fpic_ifac_db.tb_ifac_clm_outst_his t
    LEFT JOIN fpic_ifac_db.tb_ifac_clm_inwd_info d
      ON t.c_batch_no = d.c_batch_no
    LEFT JOIN fpic_ifac_db.tb_ifac_plcy_main pm
      ON pm.c_appl_no = d.c_appl_no
    CROSS JOIN params prm
    WHERE t.d_outst_time >= prm.ifac_begin_time
      AND t.d_outst_time <  prm.ifac_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_all_std AS (
    SELECT
        NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
        t.n_orig_outst_tms AS n_outst_tms,
        NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
        t.n_endr_tms AS n_endr_tms,
        NULLIF(TRIM(t.c_kind_no), '') AS c_kind_no,
        NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
        NULLIF(TRIM(t.c_dept_code), '') AS c_dept_code,
        NULLIF(TRIM(CAST(t.c_bsns_src AS CHAR)), '') AS c_bsns_src,
        NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_outst_amnt, 0) END AS n_outst_amnt,
        COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_outst_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
        COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,

        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_outst_amnt, 0) END AS n_rmb_outst_amnt,
        COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
        CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' THEN -COALESCE(t.n_rmb_outst_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
        COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,

        COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
    FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
    CROSS JOIN params prm
    WHERE t.d_clm_generate_time >= prm.ri_begin_time
      AND t.d_clm_generate_time <  prm.ri_end_time
      AND (prm.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
),

ri_std AS (
    SELECT r.*
    FROM ri_all_std r
    CROSS JOIN params prm
    WHERE r.c_bsns_src <=> prm.target_bsns_src
),

ifac_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ifac_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,

        COUNT(*) AS record_cnt,

        SUM(n_outst_amnt)              AS n_outst_amnt,
        SUM(n_fee_outst_amnt)          AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt)         AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt)     AS n_this_fee_settl_amnt,

        SUM(n_rmb_outst_amnt)          AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt)      AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt)     AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,

        MAX(n_rmb_exch)                AS n_rmb_exch
    FROM ri_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

ri_all_key AS (
    SELECT
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency,
        COUNT(*) AS record_cnt,
        SUM(n_outst_amnt) AS n_outst_amnt,
        SUM(n_fee_outst_amnt) AS n_fee_outst_amnt,
        SUM(n_this_settl_amnt) AS n_this_settl_amnt,
        SUM(n_this_fee_settl_amnt) AS n_this_fee_settl_amnt,
        SUM(n_rmb_outst_amnt) AS n_rmb_outst_amnt,
        SUM(n_rmb_fee_outst_amnt) AS n_rmb_fee_outst_amnt,
        SUM(n_rmb_this_settl_amnt) AS n_rmb_this_settl_amnt,
        SUM(n_rmb_this_fee_settl_amnt) AS n_rmb_this_fee_settl_amnt,
        MAX(n_rmb_exch) AS n_rmb_exch
    FROM ri_all_std
    GROUP BY
        c_rgst_no,
        n_outst_tms,
        c_plcy_no,
        n_endr_tms,
        c_kind_no,
        c_prod_no,
        c_dept_code,
        c_bsns_src,
        c_currency
),

amt_cmp AS (
    SELECT
        c.c_rgst_no,
        c.n_outst_tms,
        c.c_plcy_no,
        c.n_endr_tms,
        c.c_kind_no,
        c.c_prod_no,
        c.c_dept_code,
        c.c_bsns_src,
        c.c_currency,

        c.record_cnt AS ifac_record_cnt,
        r.record_cnt AS ri_record_cnt,

        c.n_outst_amnt AS ifac_n_outst_amnt,
        r.n_outst_amnt AS ri_n_outst_amnt,
        r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,

        c.n_fee_outst_amnt AS ifac_n_fee_outst_amnt,
        r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
        r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,

        c.n_this_settl_amnt AS ifac_n_this_settl_amnt,
        r.n_this_settl_amnt AS ri_n_this_settl_amnt,
        r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,

        c.n_this_fee_settl_amnt AS ifac_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
        r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,

        c.n_rmb_outst_amnt AS ifac_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
        r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,

        c.n_rmb_fee_outst_amnt AS ifac_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
        r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,

        c.n_rmb_this_settl_amnt AS ifac_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
        r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,

        c.n_rmb_this_fee_settl_amnt AS ifac_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
        r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,

        c.n_rmb_exch AS ifac_n_rmb_exch,
        r.n_rmb_exch AS ri_n_rmb_exch,
        r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
    FROM ifac_key c
    JOIN ri_key r
      ON c.c_rgst_no   <=> r.c_rgst_no
     AND c.n_outst_tms <=> r.n_outst_tms
     AND c.c_plcy_no   <=> r.c_plcy_no
     AND c.n_endr_tms  <=> r.n_endr_tms
     AND c.c_kind_no   <=> r.c_kind_no
     AND c.c_prod_no   <=> r.c_prod_no
     AND c.c_dept_code <=> r.c_dept_code
     AND c.c_bsns_src  <=> r.c_bsns_src
     AND c.c_currency  <=> r.c_currency
)
SELECT
    'M109' AS metric_code,
    '折人民币赔款兑换率是否一致' AS metric_name,
    CONCAT(
        '立案号=', COALESCE(c_rgst_no, '<空>'),
        '; 原未决调整次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
        '; 保单号=', COALESCE(c_plcy_no, '<空>'),
        '; 批改序号=', COALESCE(CAST(n_endr_tms AS CHAR), '<空>'),
        '; 险类代码=', COALESCE(c_kind_no, '<空>'),
        '; 产品代码=', COALESCE(c_prod_no, '<空>'),
        '; 机构代码=', COALESCE(c_dept_code, '<空>'),
        '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
        '; 币种=', COALESCE(c_currency, '<空>')
    ) AS business_dimension,
    '折人民币赔款兑换率' AS diff_item,
    c_rgst_no,
    n_outst_tms,
    c_plcy_no,
    n_endr_tms,
    c_kind_no,
    c_prod_no,
    c_dept_code,
    c_bsns_src,
    c_currency,
    ifac_n_rmb_exch AS ifac_amount,
    ri_n_rmb_exch AS ri_amount,
    diff_n_rmb_exch AS diff_amount,
    '不通过' AS check_result
FROM amt_cmp
CROSS JOIN params p
WHERE ABS(diff_n_rmb_exch) > p.amt_tol;
