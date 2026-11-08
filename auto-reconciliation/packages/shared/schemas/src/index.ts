import { z } from "zod";

/** 金额字符串：最多 4 位小数，对应 numeric(19,4) */
export const moneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, "金额必须是最多 4 位小数的十进制字符串");

/** 费率字符串：最多 6 位小数，对应 numeric(10,6) */
export const rateStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,6})?$/, "费率必须是最多 6 位小数的十进制字符串");

/** 操作者：user:<id> 或 agent:<id> */
export const actorSchema = z
  .string()
  .regex(/^(user|agent):[A-Za-z0-9._:-]+$/, "操作者格式必须为 user:<id> 或 agent:<id>");

/** 业务日期 YYYY-MM-DD */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "业务日期必须为 YYYY-MM-DD");

/** 分页参数 */
export const pagerSchema = z.object({
  pageNo: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20)
});

/** 期间（含起止业务日期） */
export const periodSchema = z
  .object({
    periodStartDate: businessDateSchema,
    periodEndDate: businessDateSchema
  })
  .refine((value) => value.periodStartDate <= value.periodEndDate, {
    message: "期间起日不能晚于止日"
  });

/** 实体主键（ULID 字符串） */
export const idSchema = z.string().length(26);
