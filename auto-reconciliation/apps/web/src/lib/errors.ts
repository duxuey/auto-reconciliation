function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

/** 将后端错误转换成人能看懂的业务提示；高级模式保留原始信息。 */
export function friendlyError(error: unknown, isAdvanced = false): string {
  const message = messageOf(error);
  if (isAdvanced && message !== "") {
    return message;
  }
  if (
    message.includes("没有可对账的数据") ||
    message.includes("没有可对账的暂存数据")
  ) {
    return "所选期间没有可对账的数据。";
  }
  // 源库相关错误已由服务端脱敏（不含 host/账号/密码/SQL）
  if (message.includes("源库")) {
    return message;
  }
  if (message.includes("未激活") || message.includes("尚无已发布版本")) {
    return "该对账场景暂不可执行，请联系管理员。";
  }
  if (message.includes("状态不允许") || message.includes("版本已变化")) {
    return "差异状态已变化，请刷新后重试。";
  }
  if (message.includes("期间起日不能晚于止日")) {
    return "期间的开始日期不能晚于结束日期。";
  }
  if (message.includes("不存在")) {
    return "未找到对应数据，请刷新后重试。";
  }
  return "操作未完成，请稍后重试；如持续失败请联系管理员。";
}
