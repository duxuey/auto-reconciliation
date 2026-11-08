import type { ReactNode } from "react";

export function QueryState({
  isLoading,
  error,
  children,
  empty
}: {
  isLoading: boolean;
  error: unknown;
  children: ReactNode;
  empty?: boolean;
}) {
  if (isLoading) {
    return <div className="py-10 text-center text-sm text-slate-400">加载中…</div>;
  }
  if (error !== null && error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {message}
      </div>
    );
  }
  if (empty === true) {
    return <div className="py-10 text-center text-sm text-slate-400">暂无数据</div>;
  }
  return <>{children}</>;
}
