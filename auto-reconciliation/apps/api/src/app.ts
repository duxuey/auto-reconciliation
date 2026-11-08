import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { ZodError } from "zod";
import { config } from "./config.js";
import { AppError, toErrorEnvelope } from "./domain/errors.js";
import { resolveActor, resolveTraceId } from "./infra/actor.js";
import { logger } from "./infra/logger.js";
import { registerRoutes, type AppEnv } from "./rest/routes.js";
import { appRouter, createContext } from "./trpc/router.js";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: config.WEB_ORIGIN,
      allowHeaders: ["Content-Type", "x-actor", "x-trace-id"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    })
  );

  app.use("*", async (c, next) => {
    c.set("traceId", resolveTraceId(c.req.header("x-trace-id")));
    c.set("actor", resolveActor(c.req.header("x-actor")));
    await next();
  });

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "biz-reconciliation", traceId: c.get("traceId") })
  );

  registerRoutes(app);

  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext
    })
  );

  app.notFound((c) =>
    c.json(
      {
        code: "BIZ_RECONCILIATION_ROUTE_NOT_FOUND",
        message: "接口不存在",
        traceId: c.get("traceId"),
        retryable: false
      },
      404
    )
  );

  app.onError((error, c) => {
    const traceId = c.get("traceId");
    if (error instanceof AppError) {
      logger.warn({
        event: "request.error",
        traceId,
        code: error.code,
        path: c.req.path
      });
      return c.json(toErrorEnvelope(error, traceId), error.httpStatus as 400);
    }
    if (error instanceof ZodError) {
      const appError = new AppError(
        "BIZ_RECONCILIATION_REQUEST_INVALID_INPUT",
        "请求参数校验失败",
        error.issues
      );
      return c.json(toErrorEnvelope(appError, traceId), 400);
    }
    logger.error({
      event: "request.unhandled",
      traceId,
      path: c.req.path,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        code: "BIZ_RECONCILIATION_SERVICE_INTERNAL",
        message: "服务端内部错误",
        traceId,
        retryable: true
      },
      500
    );
  });

  return app;
}
