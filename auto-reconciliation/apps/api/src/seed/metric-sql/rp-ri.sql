-- 再保送收付 / 收付账单核对脚本
-- 说明：
-- 1. 每一段 SQL 都可以单独执行；单独执行某段 SQL 时，请先执行下方公共输入参数。
-- 2. 不使用应用临时表。
-- 3. 如需调整核对期间或金额容差，只修改下方公共输入参数。
-- 4. 收付侧账单期按 yyyy-MMM 格式处理；tb_ri_acc_trty_in、tb_ri_acc_xol_trty_in 拼接账单期时补 M 对齐。
-- 5. ri_biz_type / ri_source_table 用于体现再保侧来源业务表，便于差异定位。
-- 6. c_prtc_mark 口径：tb_ri_acc_trty_in 取表内 i.c_prtc_mark；
--    tb_ri_acc_fac_in、tb_ri_acc_xol_trty_in 无协议标识，查询和匹配时固定为 '0'。
-- 7. 收付侧 c_prtc_mark 为空时，查询和匹配时固定为 '0'。
-- 8. 再保侧取数排除 c_fee_code = '20' 的数据。
-- 9. 再保侧金额按业务表内 c_cav_flag 调整方向：D * 1，C * -1，其他/空值按 1。
-- 10. 脚本模块目录（共 4 段，其中 3 段为校验指标，1 段为辅助查询）：
--    SQL 1：按送收付时间查询本次核对批次号（辅助查询）
--    SQL 2：校验特定时间段转入的明细条数是否一致
--    SQL 3：校验每条记录对应金额是否一致
--    SQL 4：校验是否遗漏记录 / 是否多出记录

-- 公共输入参数：整份脚本只需维护这里
SET @start_time = CAST('2026-04-01 00:00:00' AS DATETIME);
SET @end_time   = CAST('2026-05-01 00:00:00' AS DATETIME);
SET @amt_tol    = CAST(0 AS DECIMAL(18, 6));

/* ============================================================
 * SQL 1：按送收付时间查询本次核对批次号
 * 结果：返回本期间再保侧产生的 c_rp_batch_no
 * ============================================================ */
WITH params AS (
    SELECT
        @start_time AS start_time,
        @end_time AS end_time,
        @amt_tol AS amt_tol
),
ri_batches AS (
    SELECT DISTINCT
        'FAC_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_fac_in' AS ri_source_table,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_batch_no AS c_rp_batch_no
    FROM fpic_ri_acc_db.tb_ri_acc_fac_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')

    UNION

    SELECT DISTINCT
        'TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_trty_in' AS ri_source_table,
        i.c_prtc_mark AS c_prtc_mark,
        i.c_batch_no AS c_rp_batch_no
    FROM fpic_ri_acc_db.tb_ri_acc_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')

    UNION

    SELECT DISTINCT
        'XOL_TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_xol_trty_in' AS ri_source_table,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_batch_no AS c_rp_batch_no
    FROM fpic_ri_acc_db.tb_ri_acc_xol_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
)
SELECT
    ri_biz_type,
    ri_source_table,
    c_prtc_mark,
    c_rp_batch_no
FROM ri_batches
ORDER BY ri_biz_type, c_prtc_mark, c_rp_batch_no;


/* ============================================================
 * SQL 2：校验特定时间段转入的明细条数是否一致
 * 结果：diff_count = 0 表示条数一致
 * ============================================================ */
WITH params AS (
    SELECT
        @start_time AS start_time,
        @end_time AS end_time,
        @amt_tol AS amt_tol
),
ri_src AS (
    SELECT
        'FAC_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_fac_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        i.c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_fac_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        i.c_fee_currency,
        i.c_fee_code

    UNION ALL

    SELECT
        'TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_trty_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        CONCAT(i.c_bill_year, '-', LPAD(i.c_bill_month, 2, '0'), 'M') AS c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        i.c_prtc_mark AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_year,
        i.c_bill_month,
        i.c_trty_no,
        i.c_bill_type,
        i.c_prtc_mark,
        i.c_fee_currency,
        i.c_fee_code

    UNION ALL

    SELECT
        'XOL_TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_xol_trty_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        CONCAT(i.c_bill_year, '-', LPAD(i.c_bill_month, 2, '0'), 'M') AS c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_xol_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_year,
        i.c_bill_month,
        i.c_trty_no,
        i.c_bill_type,
        i.c_fee_currency,
        i.c_fee_code
),
ri_agg AS (
    SELECT
        GROUP_CONCAT(DISTINCT ri_biz_type ORDER BY ri_biz_type SEPARATOR ',') AS ri_biz_type,
        GROUP_CONCAT(DISTINCT ri_source_table ORDER BY ri_source_table SEPARATOR ',') AS ri_source_table,
        c_rp_batch_no,
        c_dept_code,
        c_bill_period,
        c_trty_no,
        c_bill_type,
        c_prtc_mark,
        c_bill_currency,
        c_item_code,
        ROUND(SUM(item_amnt), 2) AS item_amnt,
        ROUND(SUM(item_rmb_amnt), 2) AS item_rmb_amnt
    FROM ri_src
    GROUP BY
        c_rp_batch_no,
        c_dept_code,
        c_bill_period,
        c_trty_no,
        c_bill_type,
        c_prtc_mark,
        c_bill_currency,
        c_item_code
),
ri_source_counts AS (
    SELECT
        ri_biz_type,
        ri_source_table,
        COUNT(*) AS ri_source_detail_count
    FROM ri_src
    GROUP BY
        ri_biz_type,
        ri_source_table
),
ri_batches AS (
    SELECT DISTINCT c_rp_batch_no
    FROM ri_agg
),
ri_batch_sources AS (
    SELECT
        c_rp_batch_no,
        GROUP_CONCAT(DISTINCT ri_biz_type ORDER BY ri_biz_type SEPARATOR ',') AS ri_biz_type,
        GROUP_CONCAT(DISTINCT ri_source_table ORDER BY ri_source_table SEPARATOR ',') AS ri_source_table
    FROM ri_src
    GROUP BY c_rp_batch_no
),
rp_agg AS (
    SELECT
        bs.ri_biz_type,
        bs.ri_source_table,
        p.c_rp_batch_no,
        p.c_dept_code,
        p.c_bill_period,
        p.c_trty_no,
        p.c_bill_type,
        COALESCE(NULLIF(p.c_prtc_mark, ''), '0') AS c_prtc_mark,
        c.c_bill_currency,
        c.c_item_code,
        ROUND(SUM(COALESCE(c.n_item_amnt, 0)), 2) AS item_amnt,
        ROUND(SUM(COALESCE(c.n_item_rmb_amnt, 0)), 2) AS item_rmb_amnt
    FROM fpic_rp_db.tb_rp_ri_bill_due p
    JOIN ri_batch_sources bs
        ON p.c_rp_batch_no = bs.c_rp_batch_no
    LEFT JOIN fpic_rp_db.tb_rp_ri_bill_dtl_due c
        ON p.c_inner_bill_no = c.c_inner_bill_no
    WHERE p.c_rp_batch_no IN (
        SELECT c_rp_batch_no FROM ri_batches
    )
    GROUP BY
        bs.ri_biz_type,
        bs.ri_source_table,
        p.c_rp_batch_no,
        p.c_dept_code,
        p.c_bill_period,
        p.c_trty_no,
        p.c_bill_type,
        COALESCE(NULLIF(p.c_prtc_mark, ''), '0'),
        c.c_bill_currency,
        c.c_item_code
)
SELECT
    'DETAIL_COUNT_CHECK' AS check_type,
    (
        SELECT GROUP_CONCAT(
                   CONCAT(ri_biz_type, '/', ri_source_table, ':', ri_source_detail_count)
                   ORDER BY ri_biz_type
                   SEPARATOR '; '
               )
        FROM ri_source_counts
    ) AS ri_source_detail_count,
    (SELECT COUNT(*) FROM ri_agg) AS ri_detail_count,
    (SELECT COUNT(*) FROM rp_agg) AS rp_detail_count,
    (SELECT COUNT(*) FROM rp_agg) - (SELECT COUNT(*) FROM ri_agg) AS diff_count;


/* ============================================================
 * SQL 3：校验每条记录对应金额是否一致
 * 结果：无返回记录表示金额一致
 * ============================================================ */
WITH params AS (
    SELECT
        @start_time AS start_time,
        @end_time AS end_time,
        @amt_tol AS amt_tol
),
ri_src AS (
    SELECT
        'FAC_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_fac_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        i.c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_fac_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        i.c_fee_currency,
        i.c_fee_code

    UNION ALL

    SELECT
        'TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_trty_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        CONCAT(i.c_bill_year, '-', LPAD(i.c_bill_month, 2, '0'), 'M') AS c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        i.c_prtc_mark AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_year,
        i.c_bill_month,
        i.c_trty_no,
        i.c_bill_type,
        i.c_prtc_mark,
        i.c_fee_currency,
        i.c_fee_code

    UNION ALL

    SELECT
        'XOL_TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_xol_trty_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        CONCAT(i.c_bill_year, '-', LPAD(i.c_bill_month, 2, '0'), 'M') AS c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_xol_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_year,
        i.c_bill_month,
        i.c_trty_no,
        i.c_bill_type,
        i.c_fee_currency,
        i.c_fee_code
),
ri_agg AS (
    SELECT
        GROUP_CONCAT(DISTINCT ri_biz_type ORDER BY ri_biz_type SEPARATOR ',') AS ri_biz_type,
        GROUP_CONCAT(DISTINCT ri_source_table ORDER BY ri_source_table SEPARATOR ',') AS ri_source_table,
        c_rp_batch_no,
        c_dept_code,
        c_bill_period,
        c_trty_no,
        c_bill_type,
        c_prtc_mark,
        c_bill_currency,
        c_item_code,
        ROUND(SUM(item_amnt), 2) AS item_amnt,
        ROUND(SUM(item_rmb_amnt), 2) AS item_rmb_amnt
    FROM ri_src
    GROUP BY
        c_rp_batch_no,
        c_dept_code,
        c_bill_period,
        c_trty_no,
        c_bill_type,
        c_prtc_mark,
        c_bill_currency,
        c_item_code
),
ri_batches AS (
    SELECT DISTINCT c_rp_batch_no
    FROM ri_agg
),
ri_batch_sources AS (
    SELECT
        c_rp_batch_no,
        GROUP_CONCAT(DISTINCT ri_biz_type ORDER BY ri_biz_type SEPARATOR ',') AS ri_biz_type,
        GROUP_CONCAT(DISTINCT ri_source_table ORDER BY ri_source_table SEPARATOR ',') AS ri_source_table
    FROM ri_src
    GROUP BY c_rp_batch_no
),
rp_agg AS (
    SELECT
        bs.ri_biz_type,
        bs.ri_source_table,
        p.c_rp_batch_no,
        p.c_dept_code,
        p.c_bill_period,
        p.c_trty_no,
        p.c_bill_type,
        COALESCE(NULLIF(p.c_prtc_mark, ''), '0') AS c_prtc_mark,
        c.c_bill_currency,
        c.c_item_code,
        ROUND(SUM(COALESCE(c.n_item_amnt, 0)), 2) AS item_amnt,
        ROUND(SUM(COALESCE(c.n_item_rmb_amnt, 0)), 2) AS item_rmb_amnt
    FROM fpic_rp_db.tb_rp_ri_bill_due p
    JOIN ri_batch_sources bs
        ON p.c_rp_batch_no = bs.c_rp_batch_no
    LEFT JOIN fpic_rp_db.tb_rp_ri_bill_dtl_due c
        ON p.c_inner_bill_no = c.c_inner_bill_no
    WHERE p.c_rp_batch_no IN (
        SELECT c_rp_batch_no FROM ri_batches
    )
    GROUP BY
        bs.ri_biz_type,
        bs.ri_source_table,
        p.c_rp_batch_no,
        p.c_dept_code,
        p.c_bill_period,
        p.c_trty_no,
        p.c_bill_type,
        COALESCE(NULLIF(p.c_prtc_mark, ''), '0'),
        c.c_bill_currency,
        c.c_item_code
)
SELECT
    s.ri_biz_type,
    s.ri_source_table,
    s.c_rp_batch_no,
    s.c_dept_code,
    s.c_bill_period,
    s.c_trty_no,
    s.c_bill_type,
    s.c_prtc_mark,
    s.c_bill_currency,
    s.c_item_code,
    s.item_amnt AS ri_item_amnt,
    r.item_amnt AS rp_item_amnt,
    r.item_amnt - s.item_amnt AS diff_item_amnt,
    s.item_rmb_amnt AS ri_item_rmb_amnt,
    r.item_rmb_amnt AS rp_item_rmb_amnt,
    r.item_rmb_amnt - s.item_rmb_amnt AS diff_item_rmb_amnt
FROM ri_agg s
JOIN rp_agg r
    ON s.c_rp_batch_no   <=> r.c_rp_batch_no
   AND s.c_dept_code     <=> r.c_dept_code
   AND s.c_bill_period   <=> r.c_bill_period
   AND s.c_trty_no       <=> r.c_trty_no
   AND s.c_bill_type     <=> r.c_bill_type
   AND s.c_prtc_mark     <=> r.c_prtc_mark
   AND s.c_bill_currency <=> r.c_bill_currency
   AND s.c_item_code     <=> r.c_item_code
CROSS JOIN params p
WHERE ABS(COALESCE(r.item_amnt, 0) - COALESCE(s.item_amnt, 0)) > p.amt_tol
   OR ABS(COALESCE(r.item_rmb_amnt, 0) - COALESCE(s.item_rmb_amnt, 0)) > p.amt_tol
ORDER BY
    s.ri_biz_type,
    s.c_rp_batch_no,
    s.c_dept_code,
    s.c_bill_period,
    s.c_trty_no,
    s.c_item_code;


/* ============================================================
 * SQL 4：校验是否遗漏记录 / 是否多出记录
 * 结果：无返回记录表示无遗漏、无多出
 * ============================================================ */
WITH params AS (
    SELECT
        @start_time AS start_time,
        @end_time AS end_time,
        @amt_tol AS amt_tol
),
ri_src AS (
    SELECT
        'FAC_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_fac_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        i.c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_fac_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        i.c_fee_currency,
        i.c_fee_code

    UNION ALL

    SELECT
        'TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_trty_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        CONCAT(i.c_bill_year, '-', LPAD(i.c_bill_month, 2, '0'), 'M') AS c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        i.c_prtc_mark AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_year,
        i.c_bill_month,
        i.c_trty_no,
        i.c_bill_type,
        i.c_prtc_mark,
        i.c_fee_currency,
        i.c_fee_code

    UNION ALL

    SELECT
        'XOL_TRTY_IN' AS ri_biz_type,
        'fpic_ri_acc_db.tb_ri_acc_xol_trty_in' AS ri_source_table,
        i.c_batch_no AS c_rp_batch_no,
        i.c_dept_code,
        CONCAT(i.c_bill_year, '-', LPAD(i.c_bill_month, 2, '0'), 'M') AS c_bill_period,
        i.c_trty_no,
        i.c_bill_type,
        CAST('0' AS CHAR(1)) AS c_prtc_mark,
        i.c_fee_currency AS c_bill_currency,
        i.c_fee_code AS c_item_code,
        SUM(COALESCE(i.n_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_amnt,
        SUM(COALESCE(i.n_rmb_fee_amnt, 0) * CASE
                WHEN i.c_cav_flag = 'C' THEN -1
                WHEN i.c_cav_flag = 'D' THEN 1
                ELSE 1
            END) AS item_rmb_amnt
    FROM fpic_ri_acc_db.tb_ri_acc_xol_trty_in i
    CROSS JOIN params p
    WHERE i.d_send_rp_time >= p.start_time
      AND i.d_send_rp_time <  p.end_time
      AND i.c_batch_no IS NOT NULL
      AND i.c_batch_no <> ''
      AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
    GROUP BY
        i.c_batch_no,
        i.c_dept_code,
        i.c_bill_year,
        i.c_bill_month,
        i.c_trty_no,
        i.c_bill_type,
        i.c_fee_currency,
        i.c_fee_code
),
ri_agg AS (
    SELECT
        GROUP_CONCAT(DISTINCT ri_biz_type ORDER BY ri_biz_type SEPARATOR ',') AS ri_biz_type,
        GROUP_CONCAT(DISTINCT ri_source_table ORDER BY ri_source_table SEPARATOR ',') AS ri_source_table,
        c_rp_batch_no,
        c_dept_code,
        c_bill_period,
        c_trty_no,
        c_bill_type,
        c_prtc_mark,
        c_bill_currency,
        c_item_code,
        ROUND(SUM(item_amnt), 2) AS item_amnt,
        ROUND(SUM(item_rmb_amnt), 2) AS item_rmb_amnt
    FROM ri_src
    GROUP BY
        c_rp_batch_no,
        c_dept_code,
        c_bill_period,
        c_trty_no,
        c_bill_type,
        c_prtc_mark,
        c_bill_currency,
        c_item_code
),
ri_batches AS (
    SELECT DISTINCT c_rp_batch_no
    FROM ri_agg
),
ri_batch_sources AS (
    SELECT
        c_rp_batch_no,
        GROUP_CONCAT(DISTINCT ri_biz_type ORDER BY ri_biz_type SEPARATOR ',') AS ri_biz_type,
        GROUP_CONCAT(DISTINCT ri_source_table ORDER BY ri_source_table SEPARATOR ',') AS ri_source_table
    FROM ri_src
    GROUP BY c_rp_batch_no
),
rp_agg AS (
    SELECT
        bs.ri_biz_type,
        bs.ri_source_table,
        p.c_rp_batch_no,
        p.c_dept_code,
        p.c_bill_period,
        p.c_trty_no,
        p.c_bill_type,
        COALESCE(NULLIF(p.c_prtc_mark, ''), '0') AS c_prtc_mark,
        c.c_bill_currency,
        c.c_item_code,
        ROUND(SUM(COALESCE(c.n_item_amnt, 0)), 2) AS item_amnt,
        ROUND(SUM(COALESCE(c.n_item_rmb_amnt, 0)), 2) AS item_rmb_amnt
    FROM fpic_rp_db.tb_rp_ri_bill_due p
    JOIN ri_batch_sources bs
        ON p.c_rp_batch_no = bs.c_rp_batch_no
    LEFT JOIN fpic_rp_db.tb_rp_ri_bill_dtl_due c
        ON p.c_inner_bill_no = c.c_inner_bill_no
    WHERE p.c_rp_batch_no IN (
        SELECT c_rp_batch_no FROM ri_batches
    )
    GROUP BY
        bs.ri_biz_type,
        bs.ri_source_table,
        p.c_rp_batch_no,
        p.c_dept_code,
        p.c_bill_period,
        p.c_trty_no,
        p.c_bill_type,
        COALESCE(NULLIF(p.c_prtc_mark, ''), '0'),
        c.c_bill_currency,
        c.c_item_code
)
SELECT
    'RI_MISSING_IN_RP' AS diff_type,
    s.ri_biz_type,
    s.ri_source_table,
    s.c_rp_batch_no,
    s.c_dept_code,
    s.c_bill_period,
    s.c_trty_no,
    s.c_bill_type,
    s.c_prtc_mark,
    s.c_bill_currency,
    s.c_item_code,
    s.item_amnt,
    s.item_rmb_amnt
FROM ri_agg s
LEFT JOIN rp_agg r
    ON s.c_rp_batch_no   <=> r.c_rp_batch_no
   AND s.c_dept_code     <=> r.c_dept_code
   AND s.c_bill_period   <=> r.c_bill_period
   AND s.c_trty_no       <=> r.c_trty_no
   AND s.c_bill_type     <=> r.c_bill_type
   AND s.c_prtc_mark     <=> r.c_prtc_mark
   AND s.c_bill_currency <=> r.c_bill_currency
   AND s.c_item_code     <=> r.c_item_code
WHERE r.c_rp_batch_no IS NULL

UNION ALL

SELECT
    'RP_EXTRA_NOT_IN_RI' AS diff_type,
    r.ri_biz_type,
    r.ri_source_table,
    r.c_rp_batch_no,
    r.c_dept_code,
    r.c_bill_period,
    r.c_trty_no,
    r.c_bill_type,
    r.c_prtc_mark,
    r.c_bill_currency,
    r.c_item_code,
    r.item_amnt,
    r.item_rmb_amnt
FROM rp_agg r
LEFT JOIN ri_agg s
    ON s.c_rp_batch_no   <=> r.c_rp_batch_no
   AND s.c_dept_code     <=> r.c_dept_code
   AND s.c_bill_period   <=> r.c_bill_period
   AND s.c_trty_no       <=> r.c_trty_no
   AND s.c_bill_type     <=> r.c_bill_type
   AND s.c_prtc_mark     <=> r.c_prtc_mark
   AND s.c_bill_currency <=> r.c_bill_currency
   AND s.c_item_code     <=> r.c_item_code
WHERE s.c_rp_batch_no IS NULL
ORDER BY
    ri_biz_type,
    c_rp_batch_no,
    c_dept_code,
    c_bill_period,
    c_trty_no,
    c_item_code,
    diff_type;
