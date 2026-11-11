import type { ComponentType, SVGProps } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "../lib/cn";
import { useScope } from "../lib/scope";
import {
  IconAutomation,
  IconOverview,
  IconPack,
  IconReconWorkbench,
  IconRuns,
  IconSettings,
  IconSliders,
  IconWorkbench
} from "./icons";
import { Select } from "./ui/input";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const BUSINESS_NAV: NavItem[] = [
  { to: "/automation", label: "自动对账", icon: IconAutomation },
  { to: "/", label: "对账工作台", end: true, icon: IconWorkbench },
  { to: "/runs", label: "执行记录", icon: IconRuns }
];

const ADVANCED_NAV: NavItem[] = [
  { to: "/overview", label: "运营总览", icon: IconOverview },
  { to: "/advanced/packs", label: "指标管理", icon: IconPack },
  { to: "/advanced/settings", label: "环境配置", icon: IconSettings },
  { to: "/advanced/automation", label: "自动对账配置", icon: IconSliders }
];

interface PageMeta {
  path: string;
  exact?: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  subtitle: string;
}

/** 顶部标识与左侧菜单保持一致：切换菜单时同步图标与标题 */
const PAGE_META: PageMeta[] = [
  {
    path: "/automation",
    exact: true,
    icon: IconAutomation,
    title: "自动对账",
    subtitle: "调度执行、手动对账与通知结果"
  },
  {
    path: "/",
    exact: true,
    icon: IconWorkbench,
    title: "对账工作台",
    subtitle: "选择对账关系与期间，完成一轮对账"
  },
  {
    path: "/runs",
    icon: IconReconWorkbench,
    title: "自动对账工作台",
    subtitle: "对账执行记录与结果查询"
  },
  {
    path: "/overview",
    exact: true,
    icon: IconOverview,
    title: "运营总览",
    subtitle: "指标包健康与差异风险"
  },
  {
    path: "/advanced/packs",
    exact: true,
    icon: IconPack,
    title: "指标管理",
    subtitle: "对账关系下的指标包与指标口径"
  },
  {
    path: "/advanced/settings",
    exact: true,
    icon: IconSettings,
    title: "环境配置",
    subtitle: "环境、系统 schema 与对账关系"
  },
  {
    path: "/advanced/automation",
    exact: true,
    icon: IconSliders,
    title: "自动对账配置",
    subtitle: "调度、通知与执行范围配置"
  }
];

function matchPageMeta(pathname: string): PageMeta | undefined {
  return PAGE_META.find((item) =>
    item.exact === true
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(`${item.path}/`)
  );
}

function NavItems({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-blue-500/15 font-medium text-white ring-1 ring-inset ring-blue-400/20 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-r-full before:bg-blue-400"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive
                      ? "text-blue-300"
                      : "text-slate-400 group-hover:text-slate-200"
                  )}
                />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </>
  );
}

export function Layout() {
  const location = useLocation();
  const isRunsArea =
    location.pathname === "/runs" || location.pathname.startsWith("/runs/");
  const pageMeta = matchPageMeta(location.pathname);
  const HeaderIcon = pageMeta?.icon ?? IconReconWorkbench;
  const headerTitle = pageMeta?.title ?? "业再财自动对账";
  const headerSubtitle = pageMeta?.subtitle ?? "合约账 / 临分账自动对账";
  const {
    environments,
    environmentId,
    setEnvironmentId,
    pairs,
    pairId,
    setPairId,
    isAdvanced,
    setUiMode
  } = useScope();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800/80 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950">
        <div className="border-b border-white/5 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-base font-bold text-white shadow-lg shadow-blue-950/40">
              对
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-wide text-white">
                业再财自动对账
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-400">
                智能对账工作台
              </div>
            </div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          <NavItems items={BUSINESS_NAV} />
          {isAdvanced ? (
            <>
              <div className="px-3 pb-1 pt-5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                高级设置
              </div>
              <NavItems items={ADVANCED_NAV} />
            </>
          ) : null}
        </nav>
        <div className="mt-auto border-t border-white/5 p-3">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 transition-colors hover:bg-white/10">
            <input
              type="checkbox"
              className="mt-0.5 accent-blue-500"
              checked={isAdvanced}
              onChange={(event) =>
                setUiMode(event.target.checked ? "advanced" : "business")
              }
            />
            <span>
              <span className="block text-xs font-medium text-slate-200">高级模式</span>
              <span className="mt-0.5 block text-xs leading-4 text-slate-400">
                配置指标、环境连接与自动对账
              </span>
            </span>
          </label>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-6 shadow-card backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/25 ring-1 ring-inset ring-white/20">
              <HeaderIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold tracking-tight text-slate-900">
                {headerTitle}
              </div>
              <div className="truncate text-xs text-slate-500">
                {headerSubtitle}
              </div>
            </div>
          </div>
          {isRunsArea ? (
            isAdvanced ? null : (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-100">
                业务模式
              </span>
            )
          ) : isAdvanced ? (
            <div className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                环境
                <Select
                  className="h-9 w-32 text-xs"
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
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                对账关系
                <Select
                  className="h-9 w-52 text-xs"
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
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-100">
              业务模式
            </span>
          )}
        </header>
        <div className="mx-auto w-full max-w-[1600px] p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
