import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200/80 bg-white shadow-card",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-b border-slate-100 bg-slate-50/50 px-5 py-4",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "relative pl-3 text-base font-bold text-slate-900 before:absolute before:left-0 before:top-1 before:h-4 before:w-1 before:rounded-full before:bg-blue-500 before:content-['']",
        className
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export type StatTone =
  | "blue"
  | "indigo"
  | "emerald"
  | "amber"
  | "red"
  | "violet";

const STAT_TONES: Record<StatTone, { bar: string; tile: string }> = {
  blue: {
    bar: "from-blue-500 to-indigo-500",
    tile: "bg-blue-50 text-blue-600 ring-blue-100"
  },
  indigo: {
    bar: "from-indigo-500 to-violet-500",
    tile: "bg-indigo-50 text-indigo-600 ring-indigo-100"
  },
  emerald: {
    bar: "from-emerald-500 to-teal-500",
    tile: "bg-emerald-50 text-emerald-600 ring-emerald-100"
  },
  amber: {
    bar: "from-amber-400 to-orange-500",
    tile: "bg-amber-50 text-amber-600 ring-amber-100"
  },
  red: {
    bar: "from-red-500 to-rose-500",
    tile: "bg-red-50 text-red-600 ring-red-100"
  },
  violet: {
    bar: "from-violet-500 to-purple-500",
    tile: "bg-violet-50 text-violet-600 ring-violet-100"
  }
};

export function StatCard({
  label,
  value,
  hint,
  tone = "blue",
  icon
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
}) {
  const styles = STAT_TONES[tone];

  return (
    <Card className="group relative overflow-hidden transition-shadow hover:shadow-lift">
      <span
        aria-hidden="true"
        className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", styles.bar)}
      />
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-500">{label}</div>
          <div className="mt-2 text-stat font-bold tabular-nums tracking-tight text-slate-900">
            {value}
          </div>
          {hint === undefined ? null : (
            <div className="mt-1 text-sm text-slate-500">{hint}</div>
          )}
        </div>
        {icon === undefined ? null : (
          <div
            aria-hidden="true"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
              styles.tile
            )}
          >
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
