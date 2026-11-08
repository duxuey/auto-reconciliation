import { useCallback, useRef, useState } from "react";
import { businessToday } from "@infra/biz-reconciliation-engine";
import {
  daysInMonth,
  parseYearMonth,
  shiftMonth,
  toDateString,
  weekdayOf,
  type YearMonth
} from "../../lib/calendar";
import { cn } from "../../lib/cn";
import { useDismiss } from "../../lib/useDismiss";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  align?: "left" | "right";
}

export function DatePicker({
  value,
  onChange,
  ariaLabel,
  align = "left"
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<YearMonth>(() =>
    parseYearMonth(value !== "" ? value : businessToday())
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const today = businessToday();
  const totalDays = daysInMonth(view.year, view.month);
  const leading = (weekdayOf(view.year, view.month, 1) + 6) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => index + 1)
  ];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  function toggle(): void {
    if (!open) {
      setView(parseYearMonth(value !== "" ? value : businessToday()));
    }
    setOpen((current) => !current);
  }

  function choose(day: number): void {
    onChange(toDateString(view.year, view.month, day));
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white pl-3 pr-3 text-left text-sm shadow-sm transition-colors hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100",
          open ? "border-blue-500 ring-2 ring-blue-100" : undefined
        )}
      >
        <span
          className={cn(
            "tabular-nums",
            value === "" ? "text-slate-400" : "text-slate-900"
          )}
        >
          {value === "" ? "选择日期" : value}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 shrink-0 text-slate-400"
        >
          <path d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-2.25 5.5v7.75c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V7.5H3.5Z" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={`${ariaLabel}日历`}
          className={cn(
            "absolute top-full z-50 mt-1.5 w-[292px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/60",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setView((current) => shiftMonth(current, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path
                  fillRule="evenodd"
                  d="M12.79 4.23a.75.75 0 0 1 0 1.06L8.08 10l4.71 4.71a.75.75 0 1 1-1.06 1.06l-5.24-5.24a.75.75 0 0 1 0-1.06l5.24-5.24a.75.75 0 0 1 1.06 0Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <span className="text-sm font-medium text-slate-800">
              {view.year} 年 {view.month} 月
            </span>
            <button
              type="button"
              aria-label="下个月"
              onClick={() => setView((current) => shiftMonth(current, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path
                  fillRule="evenodd"
                  d="M7.21 15.77a.75.75 0 0 1 0-1.06L11.92 10 7.21 5.29a.75.75 0 1 1 1.06-1.06l5.24 5.24a.75.75 0 0 1 0 1.06l-5.24 5.24a.75.75 0 0 1-1.06 0Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-[11px] text-slate-400">
            {WEEKDAYS.map((label) => (
              <span key={label} className="py-1">
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((day, index) => {
              if (day === null) {
                return <span key={`empty-${index}`} />;
              }
              const date = toDateString(view.year, view.month, day);
              const selected = date === value;
              const isToday = date === today;
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={date}
                  aria-pressed={selected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => choose(day)}
                  className={cn(
                    "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                    selected
                      ? "bg-blue-600 font-medium text-white shadow-sm"
                      : isToday
                        ? "border border-blue-300 text-blue-700 hover:bg-blue-50"
                        : "text-slate-700 hover:bg-slate-100"
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-[11px] text-slate-400">今天 {today}</span>
            <button
              type="button"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
            >
              选择今天
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
