-- 再保合约送收付（只读、单库、参数化）
-- 参数：? = 期间起，? = 期间止
SELECT
    i.n_pk_id AS c_pk_id,
    i.c_batch_no,
    i.c_dept_code,
    CONCAT(i.c_bill_year, '-', LPAD(i.c_bill_month, 2, '0'), 'M') AS c_bill_period,
    i.c_trty_no,
    i.c_bill_type,
    i.c_prtc_mark,
    i.c_fee_currency,
    i.c_fee_code,
    COALESCE(i.n_fee_amnt, 0) AS n_fee_amnt,
    COALESCE(i.n_rmb_fee_amnt, 0) AS n_rmb_fee_amnt,
    i.c_cav_flag,
    i.d_send_rp_time
FROM {{schema}}.tb_ri_acc_trty_in i
WHERE i.d_send_rp_time >= ?
  AND i.d_send_rp_time <  ?
  AND i.c_batch_no IS NOT NULL
  AND i.c_batch_no <> ''
  AND (i.c_fee_code IS NULL OR i.c_fee_code <> '20')
