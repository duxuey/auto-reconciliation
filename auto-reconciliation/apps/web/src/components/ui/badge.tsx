import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  ADJUSTMENT_STATUS_LABELS,
  DIFF_STATUS_LABELS,
  GATE_STATUS_LABELS,
  IMPORT_STATUS_LABELS,
  METRIC_RESULT_LABELS,
  RUN_STATUS_LABELS,
  statusTone
} from "../../lib/labels";

type Tone = "success" | "danger" | "warning" | "info" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
  neutral: "bg-slate-100 text-slate-600 ring-slate-200"
};

const DOT_TONES: Record<Tone, string> = {
  success: "bg-emerald-500",
  danger: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  neutral: "bg-slate-400"
};

export function Badge({
  tone = "neutral",
  children,
  className
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

function defaultLabel(code: string): string {
  return (
    METRIC_RESULT_LABELS[code] ??
    RUN_STATUS_LABELS[code] ??
    DIFF_STATUS_LABELS[code] ??
    ADJUSTMENT_STATUS_LABELS[code] ??
    GATE_STATUS_LABELS[code] ??
    IMPORT_STATUS_LABELS[code] ??
    code
  );
}

export function ResultBadge({
  result,
  label
}: {
  result: string | null | undefined;
  label?: string;
}) {
  if (result === null || result === undefined || result === "") {
    return <Badge tone="neutral">-</Badge>;
  }
  const tone = statusTone(result) as Tone;
  return (
    <Badge tone={tone}>
      <span
        aria-hidden="true"
        className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", DOT_TONES[tone])}
      />
      {label ?? defaultLabel(result)}
    </Badge>
  );
}
