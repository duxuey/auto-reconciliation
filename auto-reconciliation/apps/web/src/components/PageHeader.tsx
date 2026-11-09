import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-6 w-1.5 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500"
          />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
        </div>
        {description === undefined ? null : (
          <p className="mt-2.5 text-sm text-slate-600">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
