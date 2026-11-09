import { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { useDismiss } from "../../lib/useDismiss";

const HOURS = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0")
);
const MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0")
);
const PRESETS = ["00:00", "08:00", "08:30", "12:00", "18:00"];

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

function parseTime(value: string): { hour: string; minute: string } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    return { hour: "08", minute: "30" };
  }
  return { hour: match[1] as string, minute: match[2] as string };
}

export function TimePicker({ value, onChange, ariaLabel }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const current = parseTime(value);

  function chooseHour(hour: string): void {
    onChange(`${hour}:${current.minute}`);
  }

  function chooseMinute(minute: string): void {
    onChange(`${current.hour}:${minute}`);
  }

  function tileClass(active: boolean): string {
    return cn(
      "flex h-8 items-center justify-center rounded-md text-xs tabular-nums transition-colors",
      active
        ? "bg-blue-600 font-medium text-white shadow-sm"
        : "text-slate-600 hover:bg-slate-100"
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
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
          {value === "" ? "选择时间" : value}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 shrink-0 text-slate-400"
        >
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm.75 2.25a.75.75 0 0 0-1.5 0V10c0 .2.08.39.22.53l2.5 2.5a.75.75 0 1 0 1.06-1.06l-2.28-2.28V5.75Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={`${ariaLabel}时间选择`}
          className="absolute left-0 top-full z-50 mt-1.5 w-[268px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/60"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">选择时间</span>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-sm font-semibold tabular-nums text-blue-700">
              {current.hour}:{current.minute}
            </span>
          </div>

          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-center text-xs text-slate-400">小时</div>
              <div className="grid max-h-52 grid-cols-4 gap-1 overflow-y-auto pr-0.5">
                {HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    aria-label={`${hour} 时`}
                    aria-pressed={hour === current.hour}
                    onClick={() => chooseHour(hour)}
                    className={tileClass(hour === current.hour)}
                  >
                    {hour}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-px shrink-0 bg-slate-100" />
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-center text-xs text-slate-400">分钟</div>
              <div className="grid max-h-52 grid-cols-4 gap-1 overflow-y-auto pr-0.5">
                {MINUTES.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    aria-label={`${minute} 分`}
                    aria-pressed={minute === current.minute}
                    onClick={() => chooseMinute(minute)}
                    className={tileClass(minute === current.minute)}
                  >
                    {minute}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(preset)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs tabular-nums transition-colors",
                  preset === value
                    ? "bg-blue-50 font-medium text-blue-700"
                    : "text-slate-500 hover:bg-slate-100"
                )}
              >
                {preset}
              </button>
            ))}
            <button
              type="button"
              onClick={close}
              className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
