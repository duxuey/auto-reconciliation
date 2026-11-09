import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";

const BAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-red-500"
] as const;

export function AgingBars({
  buckets,
  total
}: {
  buckets: Array<{ label: string; count: number }>;
  total?: number;
}) {
  if (buckets.length === 0) {
    return <div className="py-6 text-center text-sm text-slate-500">暂无账龄数据</div>;
  }

  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <div className="space-y-3.5">
      {buckets.map((bucket, index) => {
        const color = BAR_COLORS[Math.min(index, BAR_COLORS.length - 1)] ?? "bg-slate-400";
        return (
          <div key={bucket.label}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-slate-600">
                <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", color)} />
                {bucket.label}
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatCount(bucket.count)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-2 rounded-full transition-[width]", color)}
                style={{ width: `${(bucket.count / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
      {total === undefined ? null : (
        <div className="border-t border-slate-100 pt-3 text-right text-xs text-slate-500">
          合计{" "}
          <span className="font-semibold tabular-nums text-slate-900">
            {formatCount(total)}
          </span>
        </div>
      )}
    </div>
  );
}
