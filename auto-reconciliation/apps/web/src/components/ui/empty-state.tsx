import type { ReactNode } from "react";
import { IconInbox } from "../icons";

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
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-500 ring-8 ring-blue-50/60">
        <IconInbox className="h-5 w-5" />
      </div>
      <div className="mt-4 text-sm font-semibold text-slate-800">{title}</div>
      {description === undefined ? null : (
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">
          {description}
        </p>
      )}
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}
