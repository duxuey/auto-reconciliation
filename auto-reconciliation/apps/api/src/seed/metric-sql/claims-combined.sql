 /*
   综合自动对账-再保理赔核对指标.sql
 
   说明：
   1. 本脚本整合《自动对账-再保理赔核对指标.sql》与《自动对账-再保理赔险别核对指标.sql》，不使用临时表。
   2. 全部指标共用一组时间、金额容差和立案号过滤参数；每个指标仍独立执行一个 CTE + SELECT，按脚本顺序返回 23 个结果集。
   3. M001-M109 为主表指标，M201-M209 为非车共保指标，M301-M303 为统一险别指标。
   4. 明细类查询返回记录即表示不通过；无返回记录表示对应指标在当前口径下通过。
   5. 险别按立案号、未决次数、保单号、产品代码、币种、标的序号、险别代码七个维度汇总；每侧 8 个金额字段全为 0 的维度不参与核对。
   6. 再保侧 c_claim_type = 4 且 c_contain_clm_flag = 1（已决赔案款）时，本次已决赔款金额按原字段取反后参与核对；未决金额及费用金额保持原值。
 */
 
 /* =========================================================
    公共输入参数：全脚本统一维护
    ========================================================= */
 SET @begin_time = CAST('2026-07-11 00:00:00' AS DATETIME);
 SET @end_time   = CAST('2026-08-01 00:00:00' AS DATETIME);
 SET @amt_tol    = CAST(0 AS DECIMAL(18, 6));
 -- 可选：执行前先 SET @exclude_rgst_no_prefix_5 = 1；不设置、置空或置 0 表示不过滤 c_rgst_no 以 5 开头的数据。
 
 /* =========================================================
    指标 M001：时间段内总记录条数是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
        GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
        GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,

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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M001' AS metric_code,
     '时间段内总记录条数是否一致' AS metric_name,
     c.cnt AS clm_count,
     r.cnt AS ri_count,
     r.cnt - c.cnt AS diff_count,
     sys.clm_sys_count_detail,
     CASE WHEN c.cnt = r.cnt THEN '通过' ELSE '不通过' END AS check_result
 FROM (SELECT COUNT(*) AS cnt FROM clm_std) c
 CROSS JOIN (SELECT COUNT(*) AS cnt FROM ri_std) r
 CROSS JOIN (
     SELECT GROUP_CONCAT(CONCAT(c_sys_code_show, ':', cnt) ORDER BY c_sys_code_show SEPARATOR '; ') AS clm_sys_count_detail
     FROM (
         SELECT
             CONCAT(COALESCE(c_sys_code, '<空>'), '/', c_sys_name) AS c_sys_code_show,
             COUNT(*) AS cnt
         FROM clm_std
         GROUP BY c_sys_code, c_sys_name
     ) s
 ) sys;
 
 /* =========================================================
    指标 M002：业务键数量是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M002' AS metric_code,
     '业务键数量是否一致' AS metric_name,
     c.cnt AS clm_key_count,
     r.cnt AS ri_key_count,
     r.cnt - c.cnt AS diff_key_count,
     CASE WHEN c.cnt = r.cnt THEN '通过' ELSE '不通过' END AS check_result
 FROM (SELECT COUNT(*) AS cnt FROM clm_key) c
 CROSS JOIN (SELECT COUNT(*) AS cnt FROM ri_key) r;
 
 /* =========================================================
    指标 M003：理赔有、再保无
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M003' AS metric_code,
     '理赔有、再保无' AS metric_name,
     c.c_sys_code_list,
     c.c_sys_name_list,
     c.c_rgst_no,
     c.n_outst_tms,
     c.c_plcy_no,
     c.c_prod_no,
     c.c_currency,
     c.record_cnt,
     '不通过' AS check_result
 FROM clm_key c
 WHERE NOT EXISTS (
     SELECT 1
     FROM ri_key r
     WHERE c.c_rgst_no   <=> r.c_rgst_no
       AND c.n_outst_tms <=> r.n_outst_tms
       AND c.c_plcy_no   <=> r.c_plcy_no
       AND c.c_prod_no   <=> r.c_prod_no
       AND c.c_currency  <=> r.c_currency
 );
 
 /* =========================================================
    指标 M004：再保有、理赔无
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M004' AS metric_code,
     '再保有、理赔无' AS metric_name,
     r.c_rgst_no,
     r.n_outst_tms,
     r.c_plcy_no,
     r.c_prod_no,
     r.c_currency,
     r.record_cnt,
     '不通过' AS check_result
 FROM ri_key r
 WHERE NOT EXISTS (
     SELECT 1
     FROM clm_key c
     WHERE c.c_rgst_no   <=> r.c_rgst_no
       AND c.n_outst_tms <=> r.n_outst_tms
       AND c.c_plcy_no   <=> r.c_plcy_no
       AND c.c_prod_no   <=> r.c_prod_no
       AND c.c_currency  <=> r.c_currency
 );
 
 /* =========================================================
    指标 M005：同一业务键下记录条数是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M005' AS metric_code,
     '同一业务键下记录条数是否一致' AS metric_name,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_record_cnt,
     ri_record_cnt,
     ri_record_cnt - clm_record_cnt AS diff_record_cnt,
     '不通过' AS check_result
 FROM amt_cmp
 WHERE clm_record_cnt <> ri_record_cnt;
 
 /* =========================================================
    指标 M006：理赔侧业务键是否重复
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M006' AS metric_code,
     '理赔侧业务键是否重复' AS metric_name,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     record_cnt,
     '不通过' AS check_result
 FROM clm_key
 WHERE record_cnt > 1;
 
 /* =========================================================
    指标 M007：再保侧业务键是否重复
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M007' AS metric_code,
     '再保侧业务键是否重复' AS metric_name,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     record_cnt,
     '不通过' AS check_result
 FROM ri_key
 WHERE record_cnt > 1;
 
 /* =========================================================
    指标 M008：同一业务键是否跨多个理赔系统
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
         COUNT(DISTINCT COALESCE(c_sys_code, '<空>')) AS c_sys_code_cnt,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M008' AS metric_code,
     '同一业务键是否跨多个理赔系统' AS metric_name,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     c_sys_code_list,
     c_sys_name_list,
     record_cnt,
     '不通过' AS check_result
 FROM clm_key
 WHERE c_sys_code_cnt > 1;
 
 /* =========================================================
    指标 M101：未决类金额是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M101' AS metric_code,
     '未决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '未决总金额' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_outst_amnt AS clm_amount,
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
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '费用总未决金额' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_fee_outst_amnt AS clm_amount,
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
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '未决总金额(本位币)' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_rmb_outst_amnt AS clm_amount,
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
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '费用总未决金额(本位币)' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_rmb_fee_outst_amnt AS clm_amount,
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
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M102' AS metric_code,
     '已决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '本次赔款已决金额' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_this_settl_amnt AS clm_amount,
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
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '本次费用已决金额' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_this_fee_settl_amnt AS clm_amount,
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
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '本次赔款已决金额(本位币)' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_rmb_this_settl_amnt AS clm_amount,
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
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '本次费用已决金额(本位币)' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_rmb_this_fee_settl_amnt AS clm_amount,
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
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         t.c_rgst_no,
         t.n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_extract_currency AS c_currency,
 
         COALESCE(t.n_this_outst_amnt, 0)       AS n_rmb_outst_amnt,
         COALESCE(t.n_this_fee_outst_amnt, 0)   AS n_rmb_fee_outst_amnt,
         COALESCE(t.n_this_settl_amnt, 0)       AS n_rmb_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)   AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_e_this_outst_amnt, 0)     AS n_outst_amnt,
         COALESCE(t.n_e_this_fee_outst_amnt, 0) AS n_fee_outst_amnt,
         COALESCE(t.n_e_this_settl_amnt, 0)     AS n_this_settl_amnt,
         COALESCE(t.n_e_this_fee_settl_amnt, 0) AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_extract_rmb_exch, 0)      AS n_rmb_exch
     FROM fpic_clm_db.tb_clm_outst t
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag='1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 ri_std AS (
     SELECT
         t.c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         t.c_plcy_no,
         t.c_prod_no,
         t.c_clm_cur AS c_currency,
 
         COALESCE(t.n_outst_amnt, 0) AS n_outst_amnt,
         COALESCE(t.n_fee_outst_amnt, 0)          AS n_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_this_settl_amnt, 0) ELSE COALESCE(t.n_this_settl_amnt, 0) END AS n_this_settl_amnt,
         COALESCE(t.n_this_fee_settl_amnt, 0)     AS n_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_outst_amnt, 0) AS n_rmb_outst_amnt,
         COALESCE(t.n_rmb_fee_outst_amnt, 0)      AS n_rmb_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(t.n_rmb_this_settl_amnt, 0) ELSE COALESCE(t.n_rmb_this_settl_amnt, 0) END AS n_rmb_this_settl_amnt,
         COALESCE(t.n_rmb_this_fee_settl_amnt, 0) AS n_rmb_this_fee_settl_amnt,
 
         COALESCE(t.n_rmb_clm_exch, 0)            AS n_rmb_exch
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
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
     FROM clm_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
 ),
 
 ri_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
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
         c_prod_no,
         c_currency
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_outst_amnt AS clm_n_outst_amnt,
         r.n_outst_amnt AS ri_n_outst_amnt,
         r.n_outst_amnt - c.n_outst_amnt AS diff_n_outst_amnt,
 
         c.n_fee_outst_amnt AS clm_n_fee_outst_amnt,
         r.n_fee_outst_amnt AS ri_n_fee_outst_amnt,
         r.n_fee_outst_amnt - c.n_fee_outst_amnt AS diff_n_fee_outst_amnt,
 
         c.n_this_settl_amnt AS clm_n_this_settl_amnt,
         r.n_this_settl_amnt AS ri_n_this_settl_amnt,
         r.n_this_settl_amnt - c.n_this_settl_amnt AS diff_n_this_settl_amnt,
 
         c.n_this_fee_settl_amnt AS clm_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt AS ri_n_this_fee_settl_amnt,
         r.n_this_fee_settl_amnt - c.n_this_fee_settl_amnt AS diff_n_this_fee_settl_amnt,
 
         c.n_rmb_outst_amnt AS clm_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt AS ri_n_rmb_outst_amnt,
         r.n_rmb_outst_amnt - c.n_rmb_outst_amnt AS diff_n_rmb_outst_amnt,
 
         c.n_rmb_fee_outst_amnt AS clm_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt AS ri_n_rmb_fee_outst_amnt,
         r.n_rmb_fee_outst_amnt - c.n_rmb_fee_outst_amnt AS diff_n_rmb_fee_outst_amnt,
 
         c.n_rmb_this_settl_amnt AS clm_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt AS ri_n_rmb_this_settl_amnt,
         r.n_rmb_this_settl_amnt - c.n_rmb_this_settl_amnt AS diff_n_rmb_this_settl_amnt,
 
         c.n_rmb_this_fee_settl_amnt AS clm_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt AS ri_n_rmb_this_fee_settl_amnt,
         r.n_rmb_this_fee_settl_amnt - c.n_rmb_this_fee_settl_amnt AS diff_n_rmb_this_fee_settl_amnt,
 
         c.n_rmb_exch AS clm_n_rmb_exch,
         r.n_rmb_exch AS ri_n_rmb_exch,
         r.n_rmb_exch - c.n_rmb_exch AS diff_n_rmb_exch
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no   <=> r.c_rgst_no
      AND c.n_outst_tms <=> r.n_outst_tms
      AND c.c_plcy_no   <=> r.c_plcy_no
      AND c.c_prod_no   <=> r.c_prod_no
      AND c.c_currency  <=> r.c_currency
 )
 SELECT
     'M109' AS metric_code,
     '折人民币赔款兑换率是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>')
     ) AS business_dimension,
     '折人民币赔款兑换率' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_currency,
     clm_n_rmb_exch AS clm_amount,
     ri_n_rmb_exch AS ri_amount,
     diff_n_rmb_exch AS diff_amount,
     '不通过' AS check_result
 FROM amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_rmb_exch) > p.amt_tol;
 
 /* =========================================================
    指标 M201：非车理赔共保总记录条数是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_coins_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_outst_amnt,
         COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
         COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
         COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     JOIN fpic_clm_db.tb_clm_outst_coins c
       ON c.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
       AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 ri_coins_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
         COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 clm_coins_base AS (
     SELECT DISTINCT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
     FROM clm_coins_std
 ),
 
 ri_coins_scope AS (
     SELECT r.*
     FROM ri_coins_std r
     WHERE EXISTS (
         SELECT 1
         FROM clm_coins_base c
         WHERE c.c_rgst_no   <=> r.c_rgst_no
           AND c.n_outst_tms <=> r.n_outst_tms
           AND c.c_plcy_no   <=> r.c_plcy_no
           AND c.c_prod_no   <=> r.c_prod_no
           AND c.c_currency  <=> r.c_currency
     )
 ),
 
 clm_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM clm_coins_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 ri_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM ri_coins_scope
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 coins_amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_bsns_src,
         c.c_currency,
         c.c_coins_code,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
         r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
         r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,
 
         c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,
 
         c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,
 
         c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt
     FROM clm_coins_key c
     JOIN ri_coins_key r
       ON c.c_rgst_no     <=> r.c_rgst_no
      AND c.n_outst_tms   <=> r.n_outst_tms
      AND c.c_plcy_no     <=> r.c_plcy_no
      AND c.c_prod_no     <=> r.c_prod_no
      AND c.c_currency    <=> r.c_currency
      AND c.c_coins_code  <=> r.c_coins_code
 )
 SELECT
     'M201' AS metric_code,
     '非车理赔共保总记录条数是否一致' AS metric_name,
     c.cnt AS clm_coins_count,
     r.cnt AS ri_coins_count,
     r.cnt - c.cnt AS diff_count,
     sys.clm_sys_count_detail,
     CASE WHEN c.cnt = r.cnt THEN '通过' ELSE '不通过' END AS check_result
 FROM (SELECT COUNT(*) AS cnt FROM clm_coins_std) c
 CROSS JOIN (SELECT COUNT(*) AS cnt FROM ri_coins_scope) r
 CROSS JOIN (
     SELECT GROUP_CONCAT(CONCAT(c_sys_code_show, ':', cnt) ORDER BY c_sys_code_show SEPARATOR '; ') AS clm_sys_count_detail
     FROM (
         SELECT
             CONCAT(COALESCE(c_sys_code, '<空>'), '/', c_sys_name) AS c_sys_code_show,
             COUNT(*) AS cnt
         FROM clm_coins_std
         GROUP BY c_sys_code, c_sys_name
     ) s
 ) sys;
 
 /* =========================================================
    指标 M202：非车理赔共保业务键数量是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_coins_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_outst_amnt,
         COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
         COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
         COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     JOIN fpic_clm_db.tb_clm_outst_coins c
       ON c.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
       AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 ri_coins_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
         COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 clm_coins_base AS (
     SELECT DISTINCT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
     FROM clm_coins_std
 ),
 
 ri_coins_scope AS (
     SELECT r.*
     FROM ri_coins_std r
     WHERE EXISTS (
         SELECT 1
         FROM clm_coins_base c
         WHERE c.c_rgst_no   <=> r.c_rgst_no
           AND c.n_outst_tms <=> r.n_outst_tms
           AND c.c_plcy_no   <=> r.c_plcy_no
           AND c.c_prod_no   <=> r.c_prod_no
           AND c.c_currency  <=> r.c_currency
     )
 ),
 
 clm_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM clm_coins_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 ri_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM ri_coins_scope
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 coins_amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_bsns_src,
         c.c_currency,
         c.c_coins_code,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
         r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
         r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,
 
         c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,
 
         c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,
 
         c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt
     FROM clm_coins_key c
     JOIN ri_coins_key r
       ON c.c_rgst_no     <=> r.c_rgst_no
      AND c.n_outst_tms   <=> r.n_outst_tms
      AND c.c_plcy_no     <=> r.c_plcy_no
      AND c.c_prod_no     <=> r.c_prod_no
      AND c.c_currency    <=> r.c_currency
      AND c.c_coins_code  <=> r.c_coins_code
 )
 SELECT
     'M202' AS metric_code,
     '非车理赔共保业务键数量是否一致' AS metric_name,
     c.cnt AS clm_coins_key_count,
     r.cnt AS ri_coins_key_count,
     r.cnt - c.cnt AS diff_key_count,
     CASE WHEN c.cnt = r.cnt THEN '通过' ELSE '不通过' END AS check_result
 FROM (SELECT COUNT(*) AS cnt FROM clm_coins_key) c
 CROSS JOIN (SELECT COUNT(*) AS cnt FROM ri_coins_key) r;
 
 /* =========================================================
    指标 M203：非车理赔共保理赔有、再保无
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_coins_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_outst_amnt,
         COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
         COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
         COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     JOIN fpic_clm_db.tb_clm_outst_coins c
       ON c.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
       AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 ri_coins_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
         COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 clm_coins_base AS (
     SELECT DISTINCT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
     FROM clm_coins_std
 ),
 
 ri_coins_scope AS (
     SELECT r.*
     FROM ri_coins_std r
     WHERE EXISTS (
         SELECT 1
         FROM clm_coins_base c
         WHERE c.c_rgst_no   <=> r.c_rgst_no
           AND c.n_outst_tms <=> r.n_outst_tms
           AND c.c_plcy_no   <=> r.c_plcy_no
           AND c.c_prod_no   <=> r.c_prod_no
           AND c.c_currency  <=> r.c_currency
     )
 ),
 
 clm_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM clm_coins_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 ri_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM ri_coins_scope
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 coins_amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_bsns_src,
         c.c_currency,
         c.c_coins_code,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
         r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
         r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,
 
         c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,
 
         c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,
 
         c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt
     FROM clm_coins_key c
     JOIN ri_coins_key r
       ON c.c_rgst_no     <=> r.c_rgst_no
      AND c.n_outst_tms   <=> r.n_outst_tms
      AND c.c_plcy_no     <=> r.c_plcy_no
      AND c.c_prod_no     <=> r.c_prod_no
      AND c.c_currency    <=> r.c_currency
      AND c.c_coins_code  <=> r.c_coins_code
 )
 SELECT
     'M203' AS metric_code,
     '非车理赔共保理赔有、再保无' AS metric_name,
     c.c_sys_code_list,
     c.c_sys_name_list,
     c.c_rgst_no,
     c.n_outst_tms,
     c.c_plcy_no,
     c.c_prod_no,
     c.c_bsns_src,
     c.c_currency,
     c.c_coins_code,
     c.record_cnt,
     '不通过' AS check_result
 FROM clm_coins_key c
 WHERE NOT EXISTS (
     SELECT 1
     FROM ri_coins_key r
     WHERE c.c_rgst_no    <=> r.c_rgst_no
       AND c.n_outst_tms  <=> r.n_outst_tms
       AND c.c_plcy_no    <=> r.c_plcy_no
       AND c.c_prod_no    <=> r.c_prod_no
       AND c.c_currency   <=> r.c_currency
       AND c.c_coins_code <=> r.c_coins_code
 );
 
 /* =========================================================
    指标 M204：非车理赔共保再保有、理赔无
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_coins_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_outst_amnt,
         COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
         COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
         COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     JOIN fpic_clm_db.tb_clm_outst_coins c
       ON c.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
       AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 ri_coins_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
         COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 clm_coins_base AS (
     SELECT DISTINCT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
     FROM clm_coins_std
 ),
 
 ri_coins_scope AS (
     SELECT r.*
     FROM ri_coins_std r
     WHERE EXISTS (
         SELECT 1
         FROM clm_coins_base c
         WHERE c.c_rgst_no   <=> r.c_rgst_no
           AND c.n_outst_tms <=> r.n_outst_tms
           AND c.c_plcy_no   <=> r.c_plcy_no
           AND c.c_prod_no   <=> r.c_prod_no
           AND c.c_currency  <=> r.c_currency
     )
 ),
 
 clm_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM clm_coins_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 ri_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM ri_coins_scope
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 coins_amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_bsns_src,
         c.c_currency,
         c.c_coins_code,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
         r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
         r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,
 
         c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,
 
         c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,
 
         c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt
     FROM clm_coins_key c
     JOIN ri_coins_key r
       ON c.c_rgst_no     <=> r.c_rgst_no
      AND c.n_outst_tms   <=> r.n_outst_tms
      AND c.c_plcy_no     <=> r.c_plcy_no
      AND c.c_prod_no     <=> r.c_prod_no
      AND c.c_currency    <=> r.c_currency
      AND c.c_coins_code  <=> r.c_coins_code
 )
 SELECT
     'M204' AS metric_code,
     '非车理赔共保再保有、理赔无' AS metric_name,
     r.c_rgst_no,
     r.n_outst_tms,
     r.c_plcy_no,
     r.c_prod_no,
     r.c_bsns_src,
     r.c_currency,
     r.c_coins_code,
     r.record_cnt,
     '不通过' AS check_result
 FROM ri_coins_key r
 WHERE NOT EXISTS (
     SELECT 1
     FROM clm_coins_key c
     WHERE c.c_rgst_no    <=> r.c_rgst_no
       AND c.n_outst_tms  <=> r.n_outst_tms
       AND c.c_plcy_no    <=> r.c_plcy_no
       AND c.c_prod_no    <=> r.c_prod_no
       AND c.c_currency   <=> r.c_currency
       AND c.c_coins_code <=> r.c_coins_code
 );
 
 /* =========================================================
    指标 M205：非车理赔共保同一业务键下记录条数是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_coins_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_outst_amnt,
         COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
         COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
         COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     JOIN fpic_clm_db.tb_clm_outst_coins c
       ON c.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
       AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 ri_coins_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
         COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 clm_coins_base AS (
     SELECT DISTINCT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
     FROM clm_coins_std
 ),
 
 ri_coins_scope AS (
     SELECT r.*
     FROM ri_coins_std r
     WHERE EXISTS (
         SELECT 1
         FROM clm_coins_base c
         WHERE c.c_rgst_no   <=> r.c_rgst_no
           AND c.n_outst_tms <=> r.n_outst_tms
           AND c.c_plcy_no   <=> r.c_plcy_no
           AND c.c_prod_no   <=> r.c_prod_no
           AND c.c_currency  <=> r.c_currency
     )
 ),
 
 clm_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM clm_coins_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 ri_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM ri_coins_scope
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 coins_amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_bsns_src,
         c.c_currency,
         c.c_coins_code,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
         r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
         r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,
 
         c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,
 
         c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,
 
         c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt
     FROM clm_coins_key c
     JOIN ri_coins_key r
       ON c.c_rgst_no     <=> r.c_rgst_no
      AND c.n_outst_tms   <=> r.n_outst_tms
      AND c.c_plcy_no     <=> r.c_plcy_no
      AND c.c_prod_no     <=> r.c_prod_no
      AND c.c_currency    <=> r.c_currency
      AND c.c_coins_code  <=> r.c_coins_code
 )
 SELECT
     'M205' AS metric_code,
     '非车理赔共保同一业务键下记录条数是否一致' AS metric_name,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_record_cnt,
     ri_record_cnt,
     ri_record_cnt - clm_record_cnt AS diff_record_cnt,
     '不通过' AS check_result
 FROM coins_amt_cmp
 WHERE clm_record_cnt <> ri_record_cnt;
 
 /* =========================================================
    指标 M206：非车理赔共保理赔侧业务键是否重复
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_coins_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_outst_amnt,
         COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
         COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
         COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     JOIN fpic_clm_db.tb_clm_outst_coins c
       ON c.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
       AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 ri_coins_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
         COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 clm_coins_base AS (
     SELECT DISTINCT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
     FROM clm_coins_std
 ),
 
 ri_coins_scope AS (
     SELECT r.*
     FROM ri_coins_std r
     WHERE EXISTS (
         SELECT 1
         FROM clm_coins_base c
         WHERE c.c_rgst_no   <=> r.c_rgst_no
           AND c.n_outst_tms <=> r.n_outst_tms
           AND c.c_plcy_no   <=> r.c_plcy_no
           AND c.c_prod_no   <=> r.c_prod_no
           AND c.c_currency  <=> r.c_currency
     )
 ),
 
 clm_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM clm_coins_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 ri_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM ri_coins_scope
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 coins_amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_bsns_src,
         c.c_currency,
         c.c_coins_code,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
         r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
         r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,
 
         c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,
 
         c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,
 
         c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt
     FROM clm_coins_key c
     JOIN ri_coins_key r
       ON c.c_rgst_no     <=> r.c_rgst_no
      AND c.n_outst_tms   <=> r.n_outst_tms
      AND c.c_plcy_no     <=> r.c_plcy_no
      AND c.c_prod_no     <=> r.c_prod_no
      AND c.c_currency    <=> r.c_currency
      AND c.c_coins_code  <=> r.c_coins_code
 )
 SELECT
     'M206' AS metric_code,
     '非车理赔共保理赔侧业务键是否重复' AS metric_name,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     record_cnt,
     '不通过' AS check_result
 FROM clm_coins_key
 WHERE record_cnt > 1;
 
 /* =========================================================
    指标 M207：非车理赔共保再保侧业务键是否重复
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_coins_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
 
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_outst_amnt,
         COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
         COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
         COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     JOIN fpic_clm_db.tb_clm_outst_coins c
       ON c.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
       AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 ri_coins_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,
 
         COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
         COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
 ),
 
 clm_coins_base AS (
     SELECT DISTINCT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency
     FROM clm_coins_std
 ),
 
 ri_coins_scope AS (
     SELECT r.*
     FROM ri_coins_std r
     WHERE EXISTS (
         SELECT 1
         FROM clm_coins_base c
         WHERE c.c_rgst_no   <=> r.c_rgst_no
           AND c.n_outst_tms <=> r.n_outst_tms
           AND c.c_plcy_no   <=> r.c_plcy_no
           AND c.c_prod_no   <=> r.c_prod_no
           AND c.c_currency  <=> r.c_currency
     )
 ),
 
 clm_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM clm_coins_std
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 ri_coins_key AS (
     SELECT
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code,
 
         COUNT(*) AS record_cnt,
         SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
         SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
         SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
         SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt
     FROM ri_coins_scope
     GROUP BY
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_bsns_src,
         c_currency,
         c_coins_code
 ),
 
 coins_amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
 
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_bsns_src,
         c.c_currency,
         c.c_coins_code,
 
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
 
         c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
         r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
         r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,
 
         c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
         r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,
 
         c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
         r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,
 
         c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
         r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt
     FROM clm_coins_key c
     JOIN ri_coins_key r
       ON c.c_rgst_no     <=> r.c_rgst_no
      AND c.n_outst_tms   <=> r.n_outst_tms
      AND c.c_plcy_no     <=> r.c_plcy_no
      AND c.c_prod_no     <=> r.c_prod_no
      AND c.c_currency    <=> r.c_currency
      AND c.c_coins_code  <=> r.c_coins_code
 )
 SELECT
     'M207' AS metric_code,
     '非车理赔共保再保侧业务键是否重复' AS metric_name,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     record_cnt,
     '不通过' AS check_result
 FROM ri_coins_key
 WHERE record_cnt > 1;
 
 /* =========================================================
    /* =========================================================
    指标 M208：非车理赔共保未决类金额是否一致
    ========================================================= */
  WITH
  params AS (
      SELECT
          @begin_time AS begin_time,
          @end_time AS end_time,
          @amt_tol AS amt_tol,
          CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
  ),

  clm_coins_std AS (
      SELECT
          NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
          CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
              WHEN 'CPROP' THEN '财险'
              WHEN 'CHTAC' THEN '意健险'
              WHEN 'CAUTO' THEN '车险理赔'
              ELSE '其他/未知'
          END AS c_sys_name,

          NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
          t.n_outst_tms AS n_outst_tms,
          NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
          NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
          '' AS c_bsns_src,
          NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
          NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,

          COALESCE(c.n_e_this_outst_amnt, 0)     AS n_coins_outst_amnt,
          COALESCE(c.n_e_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
          COALESCE(c.n_e_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
          COALESCE(c.n_e_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt,

          COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_rmb_outst_amnt,
          COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_rmb_fee_outst_amnt,
          COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_rmb_this_settl_amnt,
          COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_rmb_this_fee_settl_amnt
      FROM fpic_clm_db.tb_clm_outst t
      JOIN fpic_clm_db.tb_clm_outst_coins c
        ON c.n_prt_id = t.n_pk_id
      CROSS JOIN params p
      WHERE t.d_outst_time >= p.begin_time
        AND t.d_outst_time <  p.end_time
        AND t.c_extract_outst_flag = '1'
        AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
        AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
        AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
        AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
  ),

  ri_coins_std AS (
      SELECT
          NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
          t.n_orig_outst_tms AS n_outst_tms,
          NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
          NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
          '' AS c_bsns_src,
          NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
          NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,

          COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
          COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
          CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
          COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt,

          COALESCE(s.n_rmb_outst_amnt, 0) AS n_coins_rmb_outst_amnt,
          COALESCE(s.n_rmb_fee_outst_amnt, 0)      AS n_coins_rmb_fee_outst_amnt,
          CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_rmb_this_settl_amnt, 0) ELSE COALESCE(s.n_rmb_this_settl_amnt, 0) END AS n_coins_rmb_this_settl_amnt,
          COALESCE(s.n_rmb_this_fee_settl_amnt, 0) AS n_coins_rmb_this_fee_settl_amnt
      FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
      JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
        ON t.c_rgst_no = s.c_rgst_no
       AND t.n_orig_outst_tms = s.n_orig_outst_tms
       AND t.n_outst_tms = s.n_outst_tms
       AND t.n_rbk_seq = s.n_rbk_seq
      CROSS JOIN params p
      WHERE t.d_clm_generate_time >= p.begin_time
        AND t.d_clm_generate_time <  p.end_time
        AND t.n_rbk_seq = 0
        AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
        AND COALESCE(t.c_inwd_mark, 0) <> 1
        AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
        AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
  ),

  clm_coins_base AS (
      SELECT DISTINCT
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_currency
      FROM clm_coins_std
  ),

  ri_coins_scope AS (
      SELECT r.*
      FROM ri_coins_std r
      WHERE EXISTS (
          SELECT 1
          FROM clm_coins_base c
          WHERE c.c_rgst_no   <=> r.c_rgst_no
            AND c.n_outst_tms <=> r.n_outst_tms
            AND c.c_plcy_no   <=> r.c_plcy_no
            AND c.c_prod_no   <=> r.c_prod_no
            AND c.c_currency  <=> r.c_currency
      )
  ),

  clm_coins_key AS (
      SELECT
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code,

          GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
          GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,

          COUNT(*) AS record_cnt,
          SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
          SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
          SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
          SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt,
          SUM(n_coins_rmb_outst_amnt)          AS n_coins_rmb_outst_amnt,
          SUM(n_coins_rmb_fee_outst_amnt)      AS n_coins_rmb_fee_outst_amnt,
          SUM(n_coins_rmb_this_settl_amnt)     AS n_coins_rmb_this_settl_amnt,
          SUM(n_coins_rmb_this_fee_settl_amnt) AS n_coins_rmb_this_fee_settl_amnt
      FROM clm_coins_std
      GROUP BY
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code
  ),

  ri_coins_key AS (
      SELECT
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code,

          COUNT(*) AS record_cnt,
          SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
          SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
          SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
          SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt,
          SUM(n_coins_rmb_outst_amnt)          AS n_coins_rmb_outst_amnt,
          SUM(n_coins_rmb_fee_outst_amnt)      AS n_coins_rmb_fee_outst_amnt,
          SUM(n_coins_rmb_this_settl_amnt)     AS n_coins_rmb_this_settl_amnt,
          SUM(n_coins_rmb_this_fee_settl_amnt) AS n_coins_rmb_this_fee_settl_amnt
      FROM ri_coins_scope
      GROUP BY
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code
  ),

  coins_amt_cmp AS (
      SELECT
          c.c_sys_code_list,
          c.c_sys_name_list,

          c.c_rgst_no,
          c.n_outst_tms,
          c.c_plcy_no,
          c.c_prod_no,
          c.c_bsns_src,
          c.c_currency,
          c.c_coins_code,

          c.record_cnt AS clm_record_cnt,
          r.record_cnt AS ri_record_cnt,

          c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
          r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
          r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,

          c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
          r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
          r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,

          c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
          r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
          r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,

          c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
          r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
          r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt,

          c.n_coins_rmb_outst_amnt AS clm_n_coins_rmb_outst_amnt,
          r.n_coins_rmb_outst_amnt AS ri_n_coins_rmb_outst_amnt,
          r.n_coins_rmb_outst_amnt - c.n_coins_rmb_outst_amnt AS diff_n_coins_rmb_outst_amnt,

          c.n_coins_rmb_fee_outst_amnt AS clm_n_coins_rmb_fee_outst_amnt,
          r.n_coins_rmb_fee_outst_amnt AS ri_n_coins_rmb_fee_outst_amnt,
          r.n_coins_rmb_fee_outst_amnt - c.n_coins_rmb_fee_outst_amnt AS diff_n_coins_rmb_fee_outst_amnt,

          c.n_coins_rmb_this_settl_amnt AS clm_n_coins_rmb_this_settl_amnt,
          r.n_coins_rmb_this_settl_amnt AS ri_n_coins_rmb_this_settl_amnt,
          r.n_coins_rmb_this_settl_amnt - c.n_coins_rmb_this_settl_amnt AS diff_n_coins_rmb_this_settl_amnt,

          c.n_coins_rmb_this_fee_settl_amnt AS clm_n_coins_rmb_this_fee_settl_amnt,
          r.n_coins_rmb_this_fee_settl_amnt AS ri_n_coins_rmb_this_fee_settl_amnt,
          r.n_coins_rmb_this_fee_settl_amnt - c.n_coins_rmb_this_fee_settl_amnt AS diff_n_coins_rmb_this_fee_settl_amnt
      FROM clm_coins_key c
      JOIN ri_coins_key r
        ON c.c_rgst_no     <=> r.c_rgst_no
       AND c.n_outst_tms   <=> r.n_outst_tms
       AND c.c_plcy_no     <=> r.c_plcy_no
       AND c.c_prod_no     <=> r.c_prod_no
       AND c.c_currency    <=> r.c_currency
       AND c.c_coins_code  <=> r.c_coins_code
  )

SELECT
     'M208' AS metric_code,
     '非车理赔共保未决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保赔款未决' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_outst_amnt AS clm_amount,
     ri_n_coins_outst_amnt AS ri_amount,
     diff_n_coins_outst_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_outst_amnt) > p.amt_tol
UNION ALL
SELECT
     'M208' AS metric_code,
     '非车理赔共保未决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保费用未决' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_fee_outst_amnt AS clm_amount,
     ri_n_coins_fee_outst_amnt AS ri_amount,
     diff_n_coins_fee_outst_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_fee_outst_amnt) > p.amt_tol
UNION ALL
SELECT
     'M208' AS metric_code,
     '非车理赔共保未决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保赔款未决本位币' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_rmb_outst_amnt AS clm_amount,
     ri_n_coins_rmb_outst_amnt AS ri_amount,
     diff_n_coins_rmb_outst_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_rmb_outst_amnt) > p.amt_tol
UNION ALL
SELECT
     'M208' AS metric_code,
     '非车理赔共保未决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保费用未决本位币' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_rmb_fee_outst_amnt AS clm_amount,
     ri_n_coins_rmb_fee_outst_amnt AS ri_amount,
     diff_n_coins_rmb_fee_outst_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_rmb_fee_outst_amnt) > p.amt_tol;

/* =========================================================
    指标 M209：非车理赔共保已决类金额是否一致
    ========================================================= */
  WITH
  params AS (
      SELECT
          @begin_time AS begin_time,
          @end_time AS end_time,
          @amt_tol AS amt_tol,
          CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
  ),

  clm_coins_std AS (
      SELECT
          NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
          CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
              WHEN 'CPROP' THEN '财险'
              WHEN 'CHTAC' THEN '意健险'
              WHEN 'CAUTO' THEN '车险理赔'
              ELSE '其他/未知'
          END AS c_sys_name,

          NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
          t.n_outst_tms AS n_outst_tms,
          NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
          NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
          '' AS c_bsns_src,
          NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
          NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') AS c_coins_code,

          COALESCE(c.n_e_this_outst_amnt, 0)     AS n_coins_outst_amnt,
          COALESCE(c.n_e_this_fee_outst_amnt, 0) AS n_coins_fee_outst_amnt,
          COALESCE(c.n_e_this_settl_amnt, 0)     AS n_coins_this_settl_amnt,
          COALESCE(c.n_e_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt,

          COALESCE(c.n_this_outst_amnt, 0)     AS n_coins_rmb_outst_amnt,
          COALESCE(c.n_this_fee_outst_amnt, 0) AS n_coins_rmb_fee_outst_amnt,
          COALESCE(c.n_this_settl_amnt, 0)     AS n_coins_rmb_this_settl_amnt,
          COALESCE(c.n_this_fee_settl_amnt, 0) AS n_coins_rmb_this_fee_settl_amnt
      FROM fpic_clm_db.tb_clm_outst t
      JOIN fpic_clm_db.tb_clm_outst_coins c
        ON c.n_prt_id = t.n_pk_id
      CROSS JOIN params p
      WHERE t.d_outst_time >= p.begin_time
        AND t.d_outst_time <  p.end_time
        AND t.c_extract_outst_flag = '1'
        AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
        AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
        AND NULLIF(UPPER(TRIM(t.c_sys_code)), '') IN ('CPROP', 'CHTAC')
        AND NULLIF(TRIM(CAST(c.c_coins_code AS CHAR)), '') IS NOT NULL
  ),

  ri_coins_std AS (
      SELECT
          NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
          t.n_orig_outst_tms AS n_outst_tms,
          NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
          NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
          '' AS c_bsns_src,
          NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
          NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') AS c_coins_code,

          COALESCE(s.n_outst_amnt, 0) AS n_coins_outst_amnt,
          COALESCE(s.n_fee_outst_amnt, 0)      AS n_coins_fee_outst_amnt,
          CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS n_coins_this_settl_amnt,
          COALESCE(s.n_this_fee_settl_amnt, 0) AS n_coins_this_fee_settl_amnt,

          COALESCE(s.n_rmb_outst_amnt, 0) AS n_coins_rmb_outst_amnt,
          COALESCE(s.n_rmb_fee_outst_amnt, 0)      AS n_coins_rmb_fee_outst_amnt,
          CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_rmb_this_settl_amnt, 0) ELSE COALESCE(s.n_rmb_this_settl_amnt, 0) END AS n_coins_rmb_this_settl_amnt,
          COALESCE(s.n_rmb_this_fee_settl_amnt, 0) AS n_coins_rmb_this_fee_settl_amnt
      FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
      JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_coins s
        ON t.c_rgst_no = s.c_rgst_no
       AND t.n_orig_outst_tms = s.n_orig_outst_tms
       AND t.n_outst_tms = s.n_outst_tms
       AND t.n_rbk_seq = s.n_rbk_seq
      CROSS JOIN params p
      WHERE t.d_clm_generate_time >= p.begin_time
        AND t.d_clm_generate_time <  p.end_time
        AND t.n_rbk_seq = 0
        AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
        AND COALESCE(t.c_inwd_mark, 0) <> 1
        AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
        AND NULLIF(TRIM(CAST(s.c_coins_code AS CHAR)), '') IS NOT NULL
  ),

  clm_coins_base AS (
      SELECT DISTINCT
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_currency
      FROM clm_coins_std
  ),

  ri_coins_scope AS (
      SELECT r.*
      FROM ri_coins_std r
      WHERE EXISTS (
          SELECT 1
          FROM clm_coins_base c
          WHERE c.c_rgst_no   <=> r.c_rgst_no
            AND c.n_outst_tms <=> r.n_outst_tms
            AND c.c_plcy_no   <=> r.c_plcy_no
            AND c.c_prod_no   <=> r.c_prod_no
            AND c.c_currency  <=> r.c_currency
      )
  ),

  clm_coins_key AS (
      SELECT
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code,

          GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
          GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,

          COUNT(*) AS record_cnt,
          SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
          SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
          SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
          SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt,
          SUM(n_coins_rmb_outst_amnt)          AS n_coins_rmb_outst_amnt,
          SUM(n_coins_rmb_fee_outst_amnt)      AS n_coins_rmb_fee_outst_amnt,
          SUM(n_coins_rmb_this_settl_amnt)     AS n_coins_rmb_this_settl_amnt,
          SUM(n_coins_rmb_this_fee_settl_amnt) AS n_coins_rmb_this_fee_settl_amnt
      FROM clm_coins_std
      GROUP BY
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code
  ),

  ri_coins_key AS (
      SELECT
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code,

          COUNT(*) AS record_cnt,
          SUM(n_coins_outst_amnt)          AS n_coins_outst_amnt,
          SUM(n_coins_fee_outst_amnt)      AS n_coins_fee_outst_amnt,
          SUM(n_coins_this_settl_amnt)     AS n_coins_this_settl_amnt,
          SUM(n_coins_this_fee_settl_amnt) AS n_coins_this_fee_settl_amnt,
          SUM(n_coins_rmb_outst_amnt)          AS n_coins_rmb_outst_amnt,
          SUM(n_coins_rmb_fee_outst_amnt)      AS n_coins_rmb_fee_outst_amnt,
          SUM(n_coins_rmb_this_settl_amnt)     AS n_coins_rmb_this_settl_amnt,
          SUM(n_coins_rmb_this_fee_settl_amnt) AS n_coins_rmb_this_fee_settl_amnt
      FROM ri_coins_scope
      GROUP BY
          c_rgst_no,
          n_outst_tms,
          c_plcy_no,
          c_prod_no,
          c_bsns_src,
          c_currency,
          c_coins_code
  ),

  coins_amt_cmp AS (
      SELECT
          c.c_sys_code_list,
          c.c_sys_name_list,

          c.c_rgst_no,
          c.n_outst_tms,
          c.c_plcy_no,
          c.c_prod_no,
          c.c_bsns_src,
          c.c_currency,
          c.c_coins_code,

          c.record_cnt AS clm_record_cnt,
          r.record_cnt AS ri_record_cnt,

          c.n_coins_outst_amnt AS clm_n_coins_outst_amnt,
          r.n_coins_outst_amnt AS ri_n_coins_outst_amnt,
          r.n_coins_outst_amnt - c.n_coins_outst_amnt AS diff_n_coins_outst_amnt,

          c.n_coins_fee_outst_amnt AS clm_n_coins_fee_outst_amnt,
          r.n_coins_fee_outst_amnt AS ri_n_coins_fee_outst_amnt,
          r.n_coins_fee_outst_amnt - c.n_coins_fee_outst_amnt AS diff_n_coins_fee_outst_amnt,

          c.n_coins_this_settl_amnt AS clm_n_coins_this_settl_amnt,
          r.n_coins_this_settl_amnt AS ri_n_coins_this_settl_amnt,
          r.n_coins_this_settl_amnt - c.n_coins_this_settl_amnt AS diff_n_coins_this_settl_amnt,

          c.n_coins_this_fee_settl_amnt AS clm_n_coins_this_fee_settl_amnt,
          r.n_coins_this_fee_settl_amnt AS ri_n_coins_this_fee_settl_amnt,
          r.n_coins_this_fee_settl_amnt - c.n_coins_this_fee_settl_amnt AS diff_n_coins_this_fee_settl_amnt,

          c.n_coins_rmb_outst_amnt AS clm_n_coins_rmb_outst_amnt,
          r.n_coins_rmb_outst_amnt AS ri_n_coins_rmb_outst_amnt,
          r.n_coins_rmb_outst_amnt - c.n_coins_rmb_outst_amnt AS diff_n_coins_rmb_outst_amnt,

          c.n_coins_rmb_fee_outst_amnt AS clm_n_coins_rmb_fee_outst_amnt,
          r.n_coins_rmb_fee_outst_amnt AS ri_n_coins_rmb_fee_outst_amnt,
          r.n_coins_rmb_fee_outst_amnt - c.n_coins_rmb_fee_outst_amnt AS diff_n_coins_rmb_fee_outst_amnt,

          c.n_coins_rmb_this_settl_amnt AS clm_n_coins_rmb_this_settl_amnt,
          r.n_coins_rmb_this_settl_amnt AS ri_n_coins_rmb_this_settl_amnt,
          r.n_coins_rmb_this_settl_amnt - c.n_coins_rmb_this_settl_amnt AS diff_n_coins_rmb_this_settl_amnt,

          c.n_coins_rmb_this_fee_settl_amnt AS clm_n_coins_rmb_this_fee_settl_amnt,
          r.n_coins_rmb_this_fee_settl_amnt AS ri_n_coins_rmb_this_fee_settl_amnt,
          r.n_coins_rmb_this_fee_settl_amnt - c.n_coins_rmb_this_fee_settl_amnt AS diff_n_coins_rmb_this_fee_settl_amnt
      FROM clm_coins_key c
      JOIN ri_coins_key r
        ON c.c_rgst_no     <=> r.c_rgst_no
       AND c.n_outst_tms   <=> r.n_outst_tms
       AND c.c_plcy_no     <=> r.c_plcy_no
       AND c.c_prod_no     <=> r.c_prod_no
       AND c.c_currency    <=> r.c_currency
       AND c.c_coins_code  <=> r.c_coins_code
  )

SELECT
     'M209' AS metric_code,
     '非车理赔共保已决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保赔款已决' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_this_settl_amnt AS clm_amount,
     ri_n_coins_this_settl_amnt AS ri_amount,
     diff_n_coins_this_settl_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_this_settl_amnt) > p.amt_tol
UNION ALL
SELECT
     'M209' AS metric_code,
     '非车理赔共保已决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保费用已决' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_this_fee_settl_amnt AS clm_amount,
     ri_n_coins_this_fee_settl_amnt AS ri_amount,
     diff_n_coins_this_fee_settl_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_this_fee_settl_amnt) > p.amt_tol
UNION ALL
SELECT
     'M209' AS metric_code,
     '非车理赔共保已决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保赔款已决本位币' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_rmb_this_settl_amnt AS clm_amount,
     ri_n_coins_rmb_this_settl_amnt AS ri_amount,
     diff_n_coins_rmb_this_settl_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_rmb_this_settl_amnt) > p.amt_tol
UNION ALL
SELECT
     'M209' AS metric_code,
     '非车理赔共保已决类金额是否一致' AS metric_name,
     CONCAT(
         '立案号=', COALESCE(c_rgst_no, '<空>'),
         '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
         '; 保单号=', COALESCE(c_plcy_no, '<空>'),
         '; 产品代码=', COALESCE(c_prod_no, '<空>'),
         '; 业务来源=', COALESCE(c_bsns_src, '<空>'),
         '; 币种=', COALESCE(c_currency, '<空>'),
         '; 共保人代码=', COALESCE(c_coins_code, '<空>')
     ) AS business_dimension,
     '共保费用已决本位币' AS diff_item,
     c_sys_code_list,
     c_sys_name_list,
     c_rgst_no,
     n_outst_tms,
     c_plcy_no,
     c_prod_no,
     c_bsns_src,
     c_currency,
     c_coins_code,
     clm_n_coins_rmb_this_fee_settl_amnt AS clm_amount,
     ri_n_coins_rmb_this_fee_settl_amnt AS ri_amount,
     diff_n_coins_rmb_this_fee_settl_amnt AS diff_amount,
     '不通过' AS check_result
 FROM coins_amt_cmp
 CROSS JOIN params p
 WHERE ABS(diff_n_coins_rmb_this_fee_settl_amnt) > p.amt_tol;

指标 M301：同一维度下标的险别赔款及费用金额是否一致
    ========================================================= */
 WITH
 params AS (
     SELECT
         @begin_time AS begin_time,
         @end_time AS end_time,
         @amt_tol AS amt_tol,
         CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 
 clm_std AS (
     SELECT
         NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
         CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '')
             WHEN 'CPROP' THEN '财险'
             WHEN 'CHTAC' THEN '意健险'
             WHEN 'CAUTO' THEN '车险理赔'
             ELSE '其他/未知'
         END AS c_sys_name,
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_extract_currency), '') AS c_currency,
         d.n_tgt_seq_no AS n_tgt_seq_no,
         NULLIF(TRIM(d.c_cvrg_no), '') AS c_cvrg_no,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS cvrg_outst_amnt,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS cvrg_this_settl_amnt,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS cvrg_rmb_outst_amnt,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS cvrg_rmb_this_settl_amnt,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS fee_outst_amnt,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS fee_this_settl_amnt,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS fee_rmb_outst_amnt,
         CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS fee_rmb_this_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     INNER JOIN fpic_clm_db.tb_clm_outst_dtl d
       ON d.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time
       AND t.d_outst_time <  p.end_time
       AND t.c_extract_outst_flag = '1'
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND (
           COALESCE(CAST(t.c_source AS CHAR), '') IN ('190', '902', '952', '953', '959', '931')
           OR NOT (
               COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_e_this_outst_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_e_this_settl_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_this_outst_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_this_settl_amnt END,
                   0
               ) = 0
           )
       )
 ),
 
 ri_cvrg_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         s.n_tgt_seq_no AS n_tgt_seq_no,
         NULLIF(TRIM(s.c_cvrg_no), '') AS c_cvrg_no,
         COALESCE(s.n_outst_amnt, 0) AS cvrg_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS cvrg_this_settl_amnt,
         COALESCE(s.n_rmb_outst_amnt, 0) AS cvrg_rmb_outst_amnt,
         CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_rmb_this_settl_amnt, 0) ELSE COALESCE(s.n_rmb_this_settl_amnt, 0) END AS cvrg_rmb_this_settl_amnt,
         0 AS fee_outst_amnt,
         0 AS fee_this_settl_amnt,
         0 AS fee_rmb_outst_amnt,
         0 AS fee_rmb_this_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     INNER JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_cvrg s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND (
           COALESCE(CAST(t.c_claim_type AS CHAR), '') IN ('0', '5', '7', '8')
           OR NOT (
               COALESCE(s.n_outst_amnt, 0) = 0
               AND COALESCE(s.n_this_settl_amnt, 0) = 0
               AND COALESCE(s.n_rmb_outst_amnt, 0) = 0
               AND COALESCE(s.n_rmb_this_settl_amnt, 0) = 0
           )
       )
 ),
 
 ri_fee_std AS (
     SELECT
         NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no,
         t.n_orig_outst_tms AS n_outst_tms,
         NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
         NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
         '' AS c_bsns_src,
         NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
         s.n_tgt_seq_no AS n_tgt_seq_no,
         NULLIF(TRIM(s.c_cvrg_no), '') AS c_cvrg_no,
         0 AS cvrg_outst_amnt,
         0 AS cvrg_this_settl_amnt,
         0 AS cvrg_rmb_outst_amnt,
         0 AS cvrg_rmb_this_settl_amnt,
         COALESCE(s.n_fee_outst_amnt, 0) AS fee_outst_amnt,
         COALESCE(s.n_this_fee_settl_amnt, 0) AS fee_this_settl_amnt,
         COALESCE(s.n_rmb_fee_outst_amnt, 0) AS fee_rmb_outst_amnt,
         COALESCE(s.n_rmb_this_fee_settl_amnt, 0) AS fee_rmb_this_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     INNER JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_fee s
       ON t.c_rgst_no = s.c_rgst_no
      AND t.n_orig_outst_tms = s.n_orig_outst_tms
      AND t.n_outst_tms = s.n_outst_tms
      AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time
       AND t.d_clm_generate_time <  p.end_time
       AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 
 clm_key_agg AS (
     SELECT
         GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
         GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list,
         '' AS clm_c_bsns_src_list,
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
         n_tgt_seq_no,
         c_cvrg_no,
         COUNT(*) AS record_cnt,
         SUM(cvrg_outst_amnt) AS cvrg_outst_amnt,
         SUM(cvrg_this_settl_amnt) AS cvrg_this_settl_amnt,
         SUM(cvrg_rmb_outst_amnt) AS cvrg_rmb_outst_amnt,
         SUM(cvrg_rmb_this_settl_amnt) AS cvrg_rmb_this_settl_amnt,
         SUM(fee_outst_amnt) AS fee_outst_amnt,
         SUM(fee_this_settl_amnt) AS fee_this_settl_amnt,
         SUM(fee_rmb_outst_amnt) AS fee_rmb_outst_amnt,
         SUM(fee_rmb_this_settl_amnt) AS fee_rmb_this_settl_amnt
     FROM clm_std
     GROUP BY
         c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no
 ),
 
 clm_key AS (
     SELECT *
     FROM clm_key_agg
     WHERE NOT (
         cvrg_outst_amnt = 0 AND cvrg_this_settl_amnt = 0
         AND cvrg_rmb_outst_amnt = 0 AND cvrg_rmb_this_settl_amnt = 0
         AND fee_outst_amnt = 0 AND fee_this_settl_amnt = 0
         AND fee_rmb_outst_amnt = 0 AND fee_rmb_this_settl_amnt = 0
     )
 ),
 
 ri_key_agg AS (
     SELECT
         '' AS ri_c_bsns_src_list,
         c_rgst_no,
         n_outst_tms,
         c_plcy_no,
         c_prod_no,
         c_currency,
         n_tgt_seq_no,
         c_cvrg_no,
         COUNT(*) AS record_cnt,
         SUM(cvrg_outst_amnt) AS cvrg_outst_amnt,
         SUM(cvrg_this_settl_amnt) AS cvrg_this_settl_amnt,
         SUM(cvrg_rmb_outst_amnt) AS cvrg_rmb_outst_amnt,
         SUM(cvrg_rmb_this_settl_amnt) AS cvrg_rmb_this_settl_amnt,
         SUM(fee_outst_amnt) AS fee_outst_amnt,
         SUM(fee_this_settl_amnt) AS fee_this_settl_amnt,
         SUM(fee_rmb_outst_amnt) AS fee_rmb_outst_amnt,
         SUM(fee_rmb_this_settl_amnt) AS fee_rmb_this_settl_amnt
     FROM (
         SELECT * FROM ri_cvrg_std
         UNION ALL
         SELECT * FROM ri_fee_std
     ) s
     GROUP BY
         c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no
 ),
 
 ri_key AS (
     SELECT *
     FROM ri_key_agg
     WHERE NOT (
         cvrg_outst_amnt = 0 AND cvrg_this_settl_amnt = 0
         AND cvrg_rmb_outst_amnt = 0 AND cvrg_rmb_this_settl_amnt = 0
         AND fee_outst_amnt = 0 AND fee_this_settl_amnt = 0
         AND fee_rmb_outst_amnt = 0 AND fee_rmb_this_settl_amnt = 0
     )
 ),
 
 amt_cmp AS (
     SELECT
         c.c_sys_code_list,
         c.c_sys_name_list,
         c.clm_c_bsns_src_list,
         r.ri_c_bsns_src_list,
         c.c_rgst_no,
         c.n_outst_tms,
         c.c_plcy_no,
         c.c_prod_no,
         c.c_currency,
         c.n_tgt_seq_no,
         c.c_cvrg_no,
         c.record_cnt AS clm_record_cnt,
         r.record_cnt AS ri_record_cnt,
         c.cvrg_outst_amnt AS clm_cvrg_outst_amnt,
         r.cvrg_outst_amnt AS ri_cvrg_outst_amnt,
         r.cvrg_outst_amnt - c.cvrg_outst_amnt AS diff_cvrg_outst_amnt,
         c.cvrg_this_settl_amnt AS clm_cvrg_this_settl_amnt,
         r.cvrg_this_settl_amnt AS ri_cvrg_this_settl_amnt,
         r.cvrg_this_settl_amnt - c.cvrg_this_settl_amnt AS diff_cvrg_this_settl_amnt,
         c.cvrg_rmb_outst_amnt AS clm_cvrg_rmb_outst_amnt,
         r.cvrg_rmb_outst_amnt AS ri_cvrg_rmb_outst_amnt,
         r.cvrg_rmb_outst_amnt - c.cvrg_rmb_outst_amnt AS diff_cvrg_rmb_outst_amnt,
         c.cvrg_rmb_this_settl_amnt AS clm_cvrg_rmb_this_settl_amnt,
         r.cvrg_rmb_this_settl_amnt AS ri_cvrg_rmb_this_settl_amnt,
         r.cvrg_rmb_this_settl_amnt - c.cvrg_rmb_this_settl_amnt AS diff_cvrg_rmb_this_settl_amnt,
         c.fee_outst_amnt AS clm_fee_outst_amnt,
         r.fee_outst_amnt AS ri_fee_outst_amnt,
         r.fee_outst_amnt - c.fee_outst_amnt AS diff_fee_outst_amnt,
         c.fee_this_settl_amnt AS clm_fee_this_settl_amnt,
         r.fee_this_settl_amnt AS ri_fee_this_settl_amnt,
         r.fee_this_settl_amnt - c.fee_this_settl_amnt AS diff_fee_this_settl_amnt,
         c.fee_rmb_outst_amnt AS clm_fee_rmb_outst_amnt,
         r.fee_rmb_outst_amnt AS ri_fee_rmb_outst_amnt,
         r.fee_rmb_outst_amnt - c.fee_rmb_outst_amnt AS diff_fee_rmb_outst_amnt,
         c.fee_rmb_this_settl_amnt AS clm_fee_rmb_this_settl_amnt,
         r.fee_rmb_this_settl_amnt AS ri_fee_rmb_this_settl_amnt,
         r.fee_rmb_this_settl_amnt - c.fee_rmb_this_settl_amnt AS diff_fee_rmb_this_settl_amnt
     FROM clm_key c
     JOIN ri_key r
       ON c.c_rgst_no    <=> r.c_rgst_no
      AND c.n_outst_tms  <=> r.n_outst_tms
      AND c.c_plcy_no    <=> r.c_plcy_no
      AND c.c_prod_no    <=> r.c_prod_no
      AND c.c_currency   <=> r.c_currency
      AND c.n_tgt_seq_no <=> r.n_tgt_seq_no
      AND c.c_cvrg_no    <=> r.c_cvrg_no
 )
 SELECT 'M301' AS metric_code, '同一维度下标的险别赔款及费用金额是否一致' AS metric_name,
        '七个查询维度完全一致，当前金额字段未核对上' AS check_hint,
        CONCAT('立案号=', COALESCE(c_rgst_no, '<空>'), '; 未决次数=', COALESCE(CAST(n_outst_tms AS CHAR), '<空>'),
               '; 保单号=', COALESCE(c_plcy_no, '<空>'), '; 产品代码=', COALESCE(c_prod_no, '<空>'),
               '; 理赔业务来源=', COALESCE(clm_c_bsns_src_list, '<空>'), '; 再保业务来源=', COALESCE(ri_c_bsns_src_list, '<空>'),
               '; 币种=', COALESCE(c_currency, '<空>'), '; 标的序号=', COALESCE(CAST(n_tgt_seq_no AS CHAR), '<空>'),
               '; 险别代码=', COALESCE(c_cvrg_no, '<空>')) AS business_dimension,
        diff_item, c_sys_code_list, c_sys_name_list, c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no,
        clm_c_bsns_src_list, ri_c_bsns_src_list, c_currency, n_tgt_seq_no, c_cvrg_no,
        clm_amount, ri_amount, diff_amount, '不通过' AS check_result
 FROM (
     SELECT *, '险别未决总金额' AS diff_item, clm_cvrg_outst_amnt AS clm_amount, ri_cvrg_outst_amnt AS ri_amount, diff_cvrg_outst_amnt AS diff_amount FROM amt_cmp
     UNION ALL
     SELECT *, '险别本次赔款已决金额', clm_cvrg_this_settl_amnt, ri_cvrg_this_settl_amnt, diff_cvrg_this_settl_amnt FROM amt_cmp
     UNION ALL
     SELECT *, '险别未决总金额(本位币)', clm_cvrg_rmb_outst_amnt, ri_cvrg_rmb_outst_amnt, diff_cvrg_rmb_outst_amnt FROM amt_cmp
     UNION ALL
     SELECT *, '险别本次赔款已决金额(本位币)', clm_cvrg_rmb_this_settl_amnt, ri_cvrg_rmb_this_settl_amnt, diff_cvrg_rmb_this_settl_amnt FROM amt_cmp
     UNION ALL
     SELECT *, '险别费用未决总金额', clm_fee_outst_amnt, ri_fee_outst_amnt, diff_fee_outst_amnt FROM amt_cmp
     UNION ALL
     SELECT *, '险别费用本次赔款已决金额', clm_fee_this_settl_amnt, ri_fee_this_settl_amnt, diff_fee_this_settl_amnt FROM amt_cmp
     UNION ALL
     SELECT *, '险别费用未决总金额(本位币)', clm_fee_rmb_outst_amnt, ri_fee_rmb_outst_amnt, diff_fee_rmb_outst_amnt FROM amt_cmp
     UNION ALL
     SELECT *, '险别费用本次赔款已决金额(本位币)', clm_fee_rmb_this_settl_amnt, ri_fee_rmb_this_settl_amnt, diff_fee_rmb_this_settl_amnt FROM amt_cmp
 ) x
 CROSS JOIN params p
 WHERE ABS(diff_amount) > p.amt_tol;
 
 /* =========================================================
    指标 M302：标的险别理赔有、再保无
    ========================================================= */
 WITH
 params AS (
     SELECT @begin_time AS begin_time, @end_time AS end_time, @amt_tol AS amt_tol,
            CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 clm_std AS (
     SELECT NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
            CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '') WHEN 'CPROP' THEN '财险' WHEN 'CHTAC' THEN '意健险' WHEN 'CAUTO' THEN '车险理赔' ELSE '其他/未知' END AS c_sys_name,
            NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no, t.n_outst_tms AS n_outst_tms,
            NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no, NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
            '' AS c_bsns_src, NULLIF(TRIM(t.c_extract_currency), '') AS c_currency, d.n_tgt_seq_no AS n_tgt_seq_no,
            NULLIF(TRIM(d.c_cvrg_no), '') AS c_cvrg_no,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS cvrg_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS cvrg_this_settl_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS cvrg_rmb_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS cvrg_rmb_this_settl_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS fee_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS fee_this_settl_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS fee_rmb_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS fee_rmb_this_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     INNER JOIN fpic_clm_db.tb_clm_outst_dtl d ON d.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time AND t.d_outst_time < p.end_time
       AND t.c_extract_outst_flag = '1' AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND (
           COALESCE(CAST(t.c_source AS CHAR), '') IN ('190', '902', '952', '953', '959', '931')
           OR NOT (
               COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_e_this_outst_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_e_this_settl_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_this_outst_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_this_settl_amnt END,
                   0
               ) = 0
           )
       )
 ),
 ri_cvrg_std AS (
     SELECT NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no, t.n_orig_outst_tms AS n_outst_tms, NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
            NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no, '' AS c_bsns_src, NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
            s.n_tgt_seq_no AS n_tgt_seq_no, NULLIF(TRIM(s.c_cvrg_no), '') AS c_cvrg_no,
            COALESCE(s.n_outst_amnt, 0) AS cvrg_outst_amnt,
            CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS cvrg_this_settl_amnt,
            COALESCE(s.n_rmb_outst_amnt, 0) AS cvrg_rmb_outst_amnt,
            CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_rmb_this_settl_amnt, 0) ELSE COALESCE(s.n_rmb_this_settl_amnt, 0) END AS cvrg_rmb_this_settl_amnt,
            0 AS fee_outst_amnt, 0 AS fee_this_settl_amnt, 0 AS fee_rmb_outst_amnt, 0 AS fee_rmb_this_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     INNER JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_cvrg s ON t.c_rgst_no = s.c_rgst_no AND t.n_orig_outst_tms = s.n_orig_outst_tms AND t.n_outst_tms = s.n_outst_tms AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time AND t.d_clm_generate_time < p.end_time AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1' AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND (
           COALESCE(CAST(t.c_claim_type AS CHAR), '') IN ('0', '5', '7', '8')
           OR NOT (
               COALESCE(s.n_outst_amnt, 0) = 0
               AND COALESCE(s.n_this_settl_amnt, 0) = 0
               AND COALESCE(s.n_rmb_outst_amnt, 0) = 0
               AND COALESCE(s.n_rmb_this_settl_amnt, 0) = 0
           )
       )
 ),
 ri_fee_std AS (
     SELECT NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no, t.n_orig_outst_tms AS n_outst_tms, NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
            NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no, '' AS c_bsns_src, NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
            s.n_tgt_seq_no AS n_tgt_seq_no, NULLIF(TRIM(s.c_cvrg_no), '') AS c_cvrg_no,
            0 AS cvrg_outst_amnt, 0 AS cvrg_this_settl_amnt, 0 AS cvrg_rmb_outst_amnt, 0 AS cvrg_rmb_this_settl_amnt,
            COALESCE(s.n_fee_outst_amnt, 0) AS fee_outst_amnt,
            COALESCE(s.n_this_fee_settl_amnt, 0) AS fee_this_settl_amnt,
            COALESCE(s.n_rmb_fee_outst_amnt, 0) AS fee_rmb_outst_amnt,
            COALESCE(s.n_rmb_this_fee_settl_amnt, 0) AS fee_rmb_this_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     INNER JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_fee s ON t.c_rgst_no = s.c_rgst_no AND t.n_orig_outst_tms = s.n_orig_outst_tms AND t.n_outst_tms = s.n_outst_tms AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time AND t.d_clm_generate_time < p.end_time AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1' AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 clm_key_agg AS (
     SELECT GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
            GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list, '' AS clm_c_bsns_src_list,
            c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no, COUNT(*) AS record_cnt,
            SUM(cvrg_outst_amnt) AS cvrg_outst_amnt, SUM(cvrg_this_settl_amnt) AS cvrg_this_settl_amnt,
            SUM(cvrg_rmb_outst_amnt) AS cvrg_rmb_outst_amnt, SUM(cvrg_rmb_this_settl_amnt) AS cvrg_rmb_this_settl_amnt,
            SUM(fee_outst_amnt) AS fee_outst_amnt, SUM(fee_this_settl_amnt) AS fee_this_settl_amnt,
            SUM(fee_rmb_outst_amnt) AS fee_rmb_outst_amnt, SUM(fee_rmb_this_settl_amnt) AS fee_rmb_this_settl_amnt
     FROM clm_std
     GROUP BY c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no
 ),
 clm_key AS (
     SELECT *
     FROM clm_key_agg
     WHERE NOT (
         cvrg_outst_amnt = 0 AND cvrg_this_settl_amnt = 0
         AND cvrg_rmb_outst_amnt = 0 AND cvrg_rmb_this_settl_amnt = 0
         AND fee_outst_amnt = 0 AND fee_this_settl_amnt = 0
         AND fee_rmb_outst_amnt = 0 AND fee_rmb_this_settl_amnt = 0
     )
 ),
 ri_key_agg AS (
     SELECT '' AS ri_c_bsns_src_list, c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no, COUNT(*) AS record_cnt,
            SUM(cvrg_outst_amnt) AS cvrg_outst_amnt, SUM(cvrg_this_settl_amnt) AS cvrg_this_settl_amnt,
            SUM(cvrg_rmb_outst_amnt) AS cvrg_rmb_outst_amnt, SUM(cvrg_rmb_this_settl_amnt) AS cvrg_rmb_this_settl_amnt,
            SUM(fee_outst_amnt) AS fee_outst_amnt, SUM(fee_this_settl_amnt) AS fee_this_settl_amnt,
            SUM(fee_rmb_outst_amnt) AS fee_rmb_outst_amnt, SUM(fee_rmb_this_settl_amnt) AS fee_rmb_this_settl_amnt
     FROM (SELECT * FROM ri_cvrg_std UNION ALL SELECT * FROM ri_fee_std) s
     GROUP BY c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no
 ),
 ri_key AS (
     SELECT *
     FROM ri_key_agg
     WHERE NOT (
         cvrg_outst_amnt = 0 AND cvrg_this_settl_amnt = 0
         AND cvrg_rmb_outst_amnt = 0 AND cvrg_rmb_this_settl_amnt = 0
         AND fee_outst_amnt = 0 AND fee_this_settl_amnt = 0
         AND fee_rmb_outst_amnt = 0 AND fee_rmb_this_settl_amnt = 0
     )
 )
 SELECT 'M302' AS metric_code, '标的险别理赔有、再保无' AS metric_name,
        '再保侧未找到七个查询维度完全一致的数据' AS check_hint,
        CONCAT('立案号=', COALESCE(c.c_rgst_no, '<空>'), '; 未决次数=', COALESCE(CAST(c.n_outst_tms AS CHAR), '<空>'),
               '; 保单号=', COALESCE(c.c_plcy_no, '<空>'), '; 产品代码=', COALESCE(c.c_prod_no, '<空>'),
               '; 理赔业务来源=', COALESCE(c.clm_c_bsns_src_list, '<无理赔记录>'), '; 再保业务来源=<无再保记录>',
               '; 币种=', COALESCE(c.c_currency, '<空>'), '; 标的序号=', COALESCE(CAST(c.n_tgt_seq_no AS CHAR), '<空>'),
               '; 险别代码=', COALESCE(c.c_cvrg_no, '<空>')) AS business_dimension,
        '理赔有、再保无' AS data_status, '理赔' AS source_side, c.c_sys_code_list, c.c_sys_name_list,
        c.c_rgst_no, c.n_outst_tms, c.c_plcy_no, c.c_prod_no, c.clm_c_bsns_src_list, '<无再保记录>' AS ri_c_bsns_src_list,
        c.c_currency, c.n_tgt_seq_no, c.c_cvrg_no, c.record_cnt AS clm_record_cnt, NULL AS ri_record_cnt,
        c.cvrg_outst_amnt AS clm_cvrg_outst_amnt, NULL AS ri_cvrg_outst_amnt, 0 - COALESCE(c.cvrg_outst_amnt, 0) AS diff_cvrg_outst_amnt,
        c.cvrg_this_settl_amnt AS clm_cvrg_this_settl_amnt, NULL AS ri_cvrg_this_settl_amnt, 0 - COALESCE(c.cvrg_this_settl_amnt, 0) AS diff_cvrg_this_settl_amnt,
        c.cvrg_rmb_outst_amnt AS clm_cvrg_rmb_outst_amnt, NULL AS ri_cvrg_rmb_outst_amnt, 0 - COALESCE(c.cvrg_rmb_outst_amnt, 0) AS diff_cvrg_rmb_outst_amnt,
        c.cvrg_rmb_this_settl_amnt AS clm_cvrg_rmb_this_settl_amnt, NULL AS ri_cvrg_rmb_this_settl_amnt, 0 - COALESCE(c.cvrg_rmb_this_settl_amnt, 0) AS diff_cvrg_rmb_this_settl_amnt,
        c.fee_outst_amnt AS clm_fee_outst_amnt, NULL AS ri_fee_outst_amnt, 0 - COALESCE(c.fee_outst_amnt, 0) AS diff_fee_outst_amnt,
        c.fee_this_settl_amnt AS clm_fee_this_settl_amnt, NULL AS ri_fee_this_settl_amnt, 0 - COALESCE(c.fee_this_settl_amnt, 0) AS diff_fee_this_settl_amnt,
        c.fee_rmb_outst_amnt AS clm_fee_rmb_outst_amnt, NULL AS ri_fee_rmb_outst_amnt, 0 - COALESCE(c.fee_rmb_outst_amnt, 0) AS diff_fee_rmb_outst_amnt,
        c.fee_rmb_this_settl_amnt AS clm_fee_rmb_this_settl_amnt, NULL AS ri_fee_rmb_this_settl_amnt, 0 - COALESCE(c.fee_rmb_this_settl_amnt, 0) AS diff_fee_rmb_this_settl_amnt,
        '不通过' AS check_result
 FROM clm_key c
 LEFT JOIN ri_key r
   ON c.c_rgst_no <=> r.c_rgst_no AND c.n_outst_tms <=> r.n_outst_tms AND c.c_plcy_no <=> r.c_plcy_no
  AND c.c_prod_no <=> r.c_prod_no AND c.c_currency <=> r.c_currency AND c.n_tgt_seq_no <=> r.n_tgt_seq_no AND c.c_cvrg_no <=> r.c_cvrg_no
 WHERE r.record_cnt IS NULL
 ORDER BY c.c_rgst_no, c.n_outst_tms, c.c_plcy_no, c.n_tgt_seq_no, c.c_cvrg_no;
 
 /* =========================================================
    指标 M303：标的险别再保有、理赔无
    ========================================================= */
 WITH
 params AS (
     SELECT @begin_time AS begin_time, @end_time AS end_time, @amt_tol AS amt_tol,
            CAST(COALESCE(@exclude_rgst_no_prefix_5, 0) AS UNSIGNED) AS exclude_rgst_no_prefix_5
 ),
 clm_std AS (
     SELECT NULLIF(UPPER(TRIM(t.c_sys_code)), '') AS c_sys_code,
            CASE COALESCE(UPPER(TRIM(t.c_sys_code)), '') WHEN 'CPROP' THEN '财险' WHEN 'CHTAC' THEN '意健险' WHEN 'CAUTO' THEN '车险理赔' ELSE '其他/未知' END AS c_sys_name,
            NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no, t.n_outst_tms AS n_outst_tms,
            NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no, NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no,
            '' AS c_bsns_src, NULLIF(TRIM(t.c_extract_currency), '') AS c_currency, d.n_tgt_seq_no AS n_tgt_seq_no,
            NULLIF(TRIM(d.c_cvrg_no), '') AS c_cvrg_no,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS cvrg_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS cvrg_this_settl_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS cvrg_rmb_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '00' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS cvrg_rmb_this_settl_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_e_this_outst_amnt, 0) ELSE 0 END AS fee_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_e_this_settl_amnt, 0) ELSE 0 END AS fee_this_settl_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_this_outst_amnt, 0) ELSE 0 END AS fee_rmb_outst_amnt,
            CASE WHEN COALESCE(TRIM(d.c_loss_category), '') = '999' THEN COALESCE(d.n_this_settl_amnt, 0) ELSE 0 END AS fee_rmb_this_settl_amnt
     FROM fpic_clm_db.tb_clm_outst t
     INNER JOIN fpic_clm_db.tb_clm_outst_dtl d ON d.n_prt_id = t.n_pk_id
     CROSS JOIN params p
     WHERE t.d_outst_time >= p.begin_time AND t.d_outst_time < p.end_time
       AND t.c_extract_outst_flag = '1' AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1'
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND (
           COALESCE(CAST(t.c_source AS CHAR), '') IN ('190', '902', '952', '953', '959', '931')
           OR NOT (
               COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_e_this_outst_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_e_this_settl_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_this_outst_amnt END,
                   0
               ) = 0
               AND COALESCE(
                   CASE WHEN COALESCE(TRIM(d.c_loss_category), '') IN ('00', '999') THEN d.n_this_settl_amnt END,
                   0
               ) = 0
           )
       )
 ),
 ri_cvrg_std AS (
     SELECT NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no, t.n_orig_outst_tms AS n_outst_tms, NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
            NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no, '' AS c_bsns_src, NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
            s.n_tgt_seq_no AS n_tgt_seq_no, NULLIF(TRIM(s.c_cvrg_no), '') AS c_cvrg_no,
            COALESCE(s.n_outst_amnt, 0) AS cvrg_outst_amnt,
            CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_this_settl_amnt, 0) ELSE COALESCE(s.n_this_settl_amnt, 0) END AS cvrg_this_settl_amnt,
            COALESCE(s.n_rmb_outst_amnt, 0) AS cvrg_rmb_outst_amnt,
            CASE WHEN COALESCE(CAST(t.c_claim_type AS CHAR), '') = '4' AND COALESCE(CAST(t.c_contain_clm_flag AS CHAR), '') = '1' THEN -COALESCE(s.n_rmb_this_settl_amnt, 0) ELSE COALESCE(s.n_rmb_this_settl_amnt, 0) END AS cvrg_rmb_this_settl_amnt,
            0 AS fee_outst_amnt, 0 AS fee_this_settl_amnt, 0 AS fee_rmb_outst_amnt, 0 AS fee_rmb_this_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     INNER JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_cvrg s ON t.c_rgst_no = s.c_rgst_no AND t.n_orig_outst_tms = s.n_orig_outst_tms AND t.n_outst_tms = s.n_outst_tms AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time AND t.d_clm_generate_time < p.end_time AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1' AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
       AND (
           COALESCE(CAST(t.c_claim_type AS CHAR), '') IN ('0', '5', '7', '8')
           OR NOT (
               COALESCE(s.n_outst_amnt, 0) = 0
               AND COALESCE(s.n_this_settl_amnt, 0) = 0
               AND COALESCE(s.n_rmb_outst_amnt, 0) = 0
               AND COALESCE(s.n_rmb_this_settl_amnt, 0) = 0
           )
       )
 ),
 ri_fee_std AS (
     SELECT NULLIF(TRIM(t.c_rgst_no), '') AS c_rgst_no, t.n_orig_outst_tms AS n_outst_tms, NULLIF(TRIM(t.c_plcy_no), '') AS c_plcy_no,
            NULLIF(TRIM(t.c_prod_no), '') AS c_prod_no, '' AS c_bsns_src, NULLIF(TRIM(t.c_clm_cur), '') AS c_currency,
            s.n_tgt_seq_no AS n_tgt_seq_no, NULLIF(TRIM(s.c_cvrg_no), '') AS c_cvrg_no,
            0 AS cvrg_outst_amnt, 0 AS cvrg_this_settl_amnt, 0 AS cvrg_rmb_outst_amnt, 0 AS cvrg_rmb_this_settl_amnt,
            COALESCE(s.n_fee_outst_amnt, 0) AS fee_outst_amnt,
            COALESCE(s.n_this_fee_settl_amnt, 0) AS fee_this_settl_amnt,
            COALESCE(s.n_rmb_fee_outst_amnt, 0) AS fee_rmb_outst_amnt,
            COALESCE(s.n_rmb_this_fee_settl_amnt, 0) AS fee_rmb_this_settl_amnt
     FROM fpic_ri_risk_db.tb_ri_intf_clm_outst t
     INNER JOIN fpic_ri_risk_db.tb_ri_intf_clm_outst_fee s ON t.c_rgst_no = s.c_rgst_no AND t.n_orig_outst_tms = s.n_orig_outst_tms AND t.n_outst_tms = s.n_outst_tms AND t.n_rbk_seq = s.n_rbk_seq
     CROSS JOIN params p
     WHERE t.d_clm_generate_time >= p.begin_time AND t.d_clm_generate_time < p.end_time AND t.n_rbk_seq = 0
       AND COALESCE(TRIM(t.c_migrate_flag), '0') <> '1' AND COALESCE(t.c_inwd_mark, 0) <> 1
       AND (p.exclude_rgst_no_prefix_5 = 0 OR LEFT(COALESCE(TRIM(t.c_rgst_no), ''), 1) <> '5')
 ),
 clm_key_agg AS (
     SELECT GROUP_CONCAT(DISTINCT COALESCE(c_sys_code, '<空>') ORDER BY COALESCE(c_sys_code, '<空>')) AS c_sys_code_list,
            GROUP_CONCAT(DISTINCT c_sys_name ORDER BY c_sys_name) AS c_sys_name_list, '' AS clm_c_bsns_src_list,
            c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no, COUNT(*) AS record_cnt,
            SUM(cvrg_outst_amnt) AS cvrg_outst_amnt, SUM(cvrg_this_settl_amnt) AS cvrg_this_settl_amnt,
            SUM(cvrg_rmb_outst_amnt) AS cvrg_rmb_outst_amnt, SUM(cvrg_rmb_this_settl_amnt) AS cvrg_rmb_this_settl_amnt,
            SUM(fee_outst_amnt) AS fee_outst_amnt, SUM(fee_this_settl_amnt) AS fee_this_settl_amnt,
            SUM(fee_rmb_outst_amnt) AS fee_rmb_outst_amnt, SUM(fee_rmb_this_settl_amnt) AS fee_rmb_this_settl_amnt
     FROM clm_std
     GROUP BY c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no
 ),
 clm_key AS (
     SELECT *
     FROM clm_key_agg
     WHERE NOT (
         cvrg_outst_amnt = 0 AND cvrg_this_settl_amnt = 0
         AND cvrg_rmb_outst_amnt = 0 AND cvrg_rmb_this_settl_amnt = 0
         AND fee_outst_amnt = 0 AND fee_this_settl_amnt = 0
         AND fee_rmb_outst_amnt = 0 AND fee_rmb_this_settl_amnt = 0
     )
 ),
 ri_key_agg AS (
     SELECT '' AS ri_c_bsns_src_list, c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no, COUNT(*) AS record_cnt,
            SUM(cvrg_outst_amnt) AS cvrg_outst_amnt, SUM(cvrg_this_settl_amnt) AS cvrg_this_settl_amnt,
            SUM(cvrg_rmb_outst_amnt) AS cvrg_rmb_outst_amnt, SUM(cvrg_rmb_this_settl_amnt) AS cvrg_rmb_this_settl_amnt,
            SUM(fee_outst_amnt) AS fee_outst_amnt, SUM(fee_this_settl_amnt) AS fee_this_settl_amnt,
            SUM(fee_rmb_outst_amnt) AS fee_rmb_outst_amnt, SUM(fee_rmb_this_settl_amnt) AS fee_rmb_this_settl_amnt
     FROM (SELECT * FROM ri_cvrg_std UNION ALL SELECT * FROM ri_fee_std) s
     GROUP BY c_rgst_no, n_outst_tms, c_plcy_no, c_prod_no, c_currency, n_tgt_seq_no, c_cvrg_no
 ),
 ri_key AS (
     SELECT *
     FROM ri_key_agg
     WHERE NOT (
         cvrg_outst_amnt = 0 AND cvrg_this_settl_amnt = 0
         AND cvrg_rmb_outst_amnt = 0 AND cvrg_rmb_this_settl_amnt = 0
         AND fee_outst_amnt = 0 AND fee_this_settl_amnt = 0
         AND fee_rmb_outst_amnt = 0 AND fee_rmb_this_settl_amnt = 0
     )
 )
 SELECT 'M303' AS metric_code, '标的险别再保有、理赔无' AS metric_name,
        '理赔侧未找到七个查询维度完全一致的数据' AS check_hint,
        CONCAT('立案号=', COALESCE(r.c_rgst_no, '<空>'), '; 未决次数=', COALESCE(CAST(r.n_outst_tms AS CHAR), '<空>'),
               '; 保单号=', COALESCE(r.c_plcy_no, '<空>'), '; 产品代码=', COALESCE(r.c_prod_no, '<空>'),
               '; 理赔业务来源=<无理赔记录>', '; 再保业务来源=', COALESCE(r.ri_c_bsns_src_list, '<无再保记录>'),
               '; 币种=', COALESCE(r.c_currency, '<空>'), '; 标的序号=', COALESCE(CAST(r.n_tgt_seq_no AS CHAR), '<空>'),
               '; 险别代码=', COALESCE(r.c_cvrg_no, '<空>')) AS business_dimension,
        '再保有、理赔无' AS data_status, '再保' AS source_side, '<无理赔记录>' AS c_sys_code_list, '<无理赔记录>' AS c_sys_name_list,
        r.c_rgst_no, r.n_outst_tms, r.c_plcy_no, r.c_prod_no, '<无理赔记录>' AS clm_c_bsns_src_list, r.ri_c_bsns_src_list,
        r.c_currency, r.n_tgt_seq_no, r.c_cvrg_no, NULL AS clm_record_cnt, r.record_cnt AS ri_record_cnt,
        NULL AS clm_cvrg_outst_amnt, r.cvrg_outst_amnt AS ri_cvrg_outst_amnt, r.cvrg_outst_amnt AS diff_cvrg_outst_amnt,
        NULL AS clm_cvrg_this_settl_amnt, r.cvrg_this_settl_amnt AS ri_cvrg_this_settl_amnt, r.cvrg_this_settl_amnt AS diff_cvrg_this_settl_amnt,
        NULL AS clm_cvrg_rmb_outst_amnt, r.cvrg_rmb_outst_amnt AS ri_cvrg_rmb_outst_amnt, r.cvrg_rmb_outst_amnt AS diff_cvrg_rmb_outst_amnt,
        NULL AS clm_cvrg_rmb_this_settl_amnt, r.cvrg_rmb_this_settl_amnt AS ri_cvrg_rmb_this_settl_amnt, r.cvrg_rmb_this_settl_amnt AS diff_cvrg_rmb_this_settl_amnt,
        NULL AS clm_fee_outst_amnt, r.fee_outst_amnt AS ri_fee_outst_amnt, r.fee_outst_amnt AS diff_fee_outst_amnt,
        NULL AS clm_fee_this_settl_amnt, r.fee_this_settl_amnt AS ri_fee_this_settl_amnt, r.fee_this_settl_amnt AS diff_fee_this_settl_amnt,
        NULL AS clm_fee_rmb_outst_amnt, r.fee_rmb_outst_amnt AS ri_fee_rmb_outst_amnt, r.fee_rmb_outst_amnt AS diff_fee_rmb_outst_amnt,
        NULL AS clm_fee_rmb_this_settl_amnt, r.fee_rmb_this_settl_amnt AS ri_fee_rmb_this_settl_amnt, r.fee_rmb_this_settl_amnt AS diff_fee_rmb_this_settl_amnt,
        '不通过' AS check_result
 FROM ri_key r
 LEFT JOIN clm_key c
   ON r.c_rgst_no <=> c.c_rgst_no AND r.n_outst_tms <=> c.n_outst_tms AND r.c_plcy_no <=> c.c_plcy_no
  AND r.c_prod_no <=> c.c_prod_no AND r.c_currency <=> c.c_currency AND r.n_tgt_seq_no <=> c.n_tgt_seq_no AND r.c_cvrg_no <=> c.c_cvrg_no
 WHERE c.record_cnt IS NULL
 ORDER BY r.c_rgst_no, r.n_outst_tms, r.c_plcy_no, r.n_tgt_seq_no, r.c_cvrg_no;
