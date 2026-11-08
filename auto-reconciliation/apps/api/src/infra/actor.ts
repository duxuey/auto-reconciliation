import { config } from "../config.js";

const ACTOR_PATTERN = /^(user|agent):[A-Za-z0-9._:-]+$/;

/** 从网关/调用方透传的操作者中取值；非法值回落到配置默认值并留痕由调用方记录 */
export function resolveActor(header: string | undefined): string {
  if (header !== undefined && ACTOR_PATTERN.test(header)) {
    return header;
  }
  return config.DEFAULT_ACTOR;
}

/** 链路 ID：优先透传，未传则生成 */
export function resolveTraceId(header: string | undefined): string {
  if (header !== undefined && header.trim() !== "") {
    return header.trim();
  }
  return crypto.randomUUID();
}
