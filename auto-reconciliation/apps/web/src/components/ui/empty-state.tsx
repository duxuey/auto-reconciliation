import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {description === undefined ? null : (
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}
