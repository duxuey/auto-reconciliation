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
    return (
      <div className="flex items-center justify-center gap-2.5 py-12 text-sm text-slate-500">
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600"
        />
        加载中…
      </div>
    );
  }
  if (error !== null && error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {message}
      </div>
    );
  }
  if (empty === true) {
    return <div className="py-12 text-center text-sm text-slate-500">暂无数据</div>;
  }
  return <>{children}</>;
}
