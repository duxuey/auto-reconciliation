import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@infra/biz-reconciliation/router";

export const trpc = createTRPCReact<AppRouter>();

export const apiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:3100";

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${apiBase}/trpc`,
        headers: {
          "x-actor": "user:web"
        }
      })
    ]
  });
}
