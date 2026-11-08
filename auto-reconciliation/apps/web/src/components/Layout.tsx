import { NavLink, Outlet } from "react-router-dom";
import { cn } from "../lib/cn";
import { useScope } from "../lib/scope";
import { Select } from "./ui/input";

const BUSINESS_NAV = [
  { to: "/", label: "对账工作台", end: true },
  { to: "/runs", label: "执行记录" },
  { to: "/diffs", label: "差异处理" },
  { to: "/adjustments", label: "调整建议" },
  { to: "/gates", label: "阶段确认" },
  { to: "/reports", label: "对账报表" },
  { to: "/automation", label: "自动对账" }
];

const ADVANCED_NAV = [
  { to: "/overview", label: "运营总览" },
  { to: "/advanced/packs", label: "指标管理" },
  { to: "/advanced/datasets", label: "数据接入" },
  { to: "/advanced/settings", label: "环境配置" }
];

function NavItems({
  items
}: {
  items: Array<{ to: string; label: string; end?: boolean }>;
}) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "block rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-blue-50 font-medium text-blue-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export function Layout() {
  const {
    environments,
    environmentId,
    setEnvironmentId,
    pairs,
    pairId,
    setPairId,
    pair,
    businessEnvironment,
    isAdvanced,
    setUiMode
  } = useScope();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="text-sm font-semibold tracking-wide text-slate-900">
            业再财自动对账
          </div>
          <div className="mt-1 text-[11px] text-slate-500">对账工作台</div>
        </div>
        <nav className="space-y-1 p-3">
          <NavItems items={BUSINESS_NAV} />
          {isAdvanced ? (
            <>
              <div className="px-3 pb-1 pt-4 text-[11px] font-medium text-slate-400">
                高级设置
              </div>
              <NavItems items={ADVANCED_NAV} />
            </>
          ) : null}
        </nav>
        <div className="mt-auto border-t border-slate-100 p-3">
          <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-slate-50">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isAdvanced}
              onChange={(event) =>
                setUiMode(event.target.checked ? "advanced" : "business")
              }
            />
            <span>
              <span className="block text-xs font-medium text-slate-700">高级模式</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
                配置指标、数据接入与环境连接
              </span>
            </span>
          </label>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-700">
              合约账 / 临分账自动对账
            </div>
            <div className="truncate text-[11px] text-slate-400">
              {isAdvanced
                ? `${environments.find((item) => item.id === environmentId)?.envName ?? "未选择环境"} · ${pair?.pairName ?? "未选择对账关系"}`
                : `${businessEnvironment?.envName ?? "未设置默认环境"} · ${pair?.pairName ?? "请在对账工作台选择对账关系"}`}
            </div>
          </div>
          {isAdvanced ? (
            <div className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                环境
                <Select
                  className="h-8 w-32 text-xs"
                  value={environmentId ?? ""}
                  onChange={(event) => setEnvironmentId(event.target.value)}
                >
                  {environments.length === 0 ? <option value="">无环境</option> : null}
                  {environments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.envCode} · {item.envName}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                对账关系
                <Select
                  className="h-8 w-52 text-xs"
                  value={pairId ?? ""}
                  onChange={(event) => setPairId(event.target.value)}
                >
                  {pairs.length === 0 ? <option value="">无对账关系</option> : null}
                  {pairs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.pairName}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-500">
              业务模式
            </span>
          )}
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
