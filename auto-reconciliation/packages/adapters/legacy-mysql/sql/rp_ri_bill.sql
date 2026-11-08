-- 收付再保账单主表 + 明细表抽取（只读、单库、参数化）
-- 参数：? = 期间起日，? = 期间止日
-- 输出的业务键/金额字段由数据集映射配置归一化，本 SQL 不做对账判断。
SELECT
    p.c_rp_batch_no       AS c_rp_batch_no,
    p.c_dept_code         AS c_dept_code,
    p.c_bill_period       AS c_bill_period,
    p.c_trty_no           AS c_trty_no,
    p.c_bill_type         AS c_bill_type,
    COALESCE(NULLIF(p.c_prtc_mark, ''), '0') AS c_prtc_mark,
    c.c_bill_currency     AS c_bill_currency,
    c.c_item_code         AS c_item_code,
    c.c_inner_bill_no     AS c_inner_bill_no,
    COALESCE(c.n_item_amnt, 0)      AS n_item_amnt,
    COALESCE(c.n_item_rmb_amnt, 0)  AS n_item_rmb_amnt,
    p.d_due_time          AS d_bill_time
FROM {{schema}}.tb_rp_ri_bill_due p
JOIN {{schema}}.tb_rp_ri_bill_dtl_due c
  ON p.c_inner_bill_no = c.c_inner_bill_no
WHERE p.c_rp_batch_no IS NOT NULL
  AND p.c_rp_batch_no <> ''
  AND p.d_due_time >= ?
  AND p.d_due_time <  ?
