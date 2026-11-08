import { describe, expect, it } from "vitest";
import { describeConnectionError } from "../src/application/environments.js";

function errorWith(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("describeConnectionError", () => {
  it("连接被服务器关闭时提示白名单/网络，不泄露地址", () => {
    const message = describeConnectionError(
      errorWith("PROTOCOL_CONNECTION_LOST", "Connection lost: The server closed the connection.")
    );
    expect(message).toContain("白名单");
    expect(message).not.toContain("10.65.10.8");
    expect(message).not.toContain("Connection lost");
  });

  it("拒绝连接时只输出可操作提示", () => {
    const message = describeConnectionError(
      errorWith("ECONNREFUSED", "connect ECONNREFUSED 10.65.10.8:3306")
    );
    expect(message).toContain("端口未开放");
    expect(message).not.toContain("10.65.10.8");
  });

  it("账号密码错误与主机被封禁有明确提示", () => {
    expect(describeConnectionError(errorWith("ER_ACCESS_DENIED_ERROR", ""))).toContain(
      "账号或密码错误"
    );
    expect(describeConnectionError(errorWith("ER_HOST_IS_BLOCKED", ""))).toContain(
      "FLUSH HOSTS"
    );
  });

  it("未知错误只回错误类型", () => {
    const message = describeConnectionError(
      errorWith("SOME_DRIVER_ERROR", "host=10.65.10.8 user=dba_all")
    );
    expect(message).toBe("连接失败（错误类型 SOME_DRIVER_ERROR）。");
    expect(message).not.toContain("10.65.10.8");
    expect(message).not.toContain("dba_all");
  });
});
