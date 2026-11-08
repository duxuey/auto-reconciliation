import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { trpc } from "./trpc";

const ENV_STORAGE_KEY = "recon.environmentId";
const PAIR_STORAGE_KEY = "recon.pairId";
const UI_MODE_STORAGE_KEY = "recon.uiMode";

export type UiMode = "business" | "advanced";

export interface EnvironmentOption {
  id: string;
  envCode: string;
  envName: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPasswordEnvKey: string;
  defaultDatabase: string | null;
  envStatus: string;
  isDefault: boolean;
}

export interface PairOption {
  id: string;
  pairCode: string;
  pairName: string;
  leftSystemName: string;
  rightSystemName: string;
  pairStatus: string;
  description: string | null;
  packCount: number;
}

interface ScopeValue {
  environments: EnvironmentOption[];
  environmentId: string | undefined;
  environment: EnvironmentOption | undefined;
  environmentsLoading: boolean;
  businessEnvironmentId: string | undefined;
  businessEnvironment: EnvironmentOption | undefined;
  pairs: PairOption[];
  pairId: string | undefined;
  pair: PairOption | undefined;
  pairsLoading: boolean;
  uiMode: UiMode;
  isAdvanced: boolean;
  setUiMode: (mode: UiMode) => void;
  setEnvironmentId: (id: string) => void;
  setPairId: (id: string) => void;
}

const ScopeContext = createContext<ScopeValue | null>(null);

function readStored(key: string): string {
  return window.localStorage.getItem(key) ?? "";
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const environmentQuery = trpc.environment.list.useQuery();
  const pairQuery = trpc.pair.list.useQuery();
  const [environmentId, setEnvironmentIdState] = useState(() => readStored(ENV_STORAGE_KEY));
  const [pairId, setPairIdState] = useState(() => readStored(PAIR_STORAGE_KEY));
  const [uiMode, setUiModeState] = useState<UiMode>(() =>
    readStored(UI_MODE_STORAGE_KEY) === "advanced" ? "advanced" : "business"
  );

  const environments = useMemo(
    () => environmentQuery.data ?? [],
    [environmentQuery.data]
  );
  const pairs = useMemo(() => pairQuery.data ?? [], [pairQuery.data]);
  const businessEnvironment = useMemo(
    () =>
      environments.find((item) => item.isDefault) ??
      environments.find((item) => item.envStatus === "ACTIVE") ??
      environments[0],
    [environments]
  );

  // 存储的环境已失效时回退到默认环境；使用函数式更新，避免覆盖用户刚做出的选择
  useEffect(() => {
    const items = environmentQuery.data;
    if (items === undefined || items.length === 0) {
      return;
    }
    const first = items[0];
    if (first === undefined) {
      return;
    }
    const fallback =
      items.find((item) => item.isDefault) ??
      items.find((item) => item.envStatus === "ACTIVE") ??
      first;
    setEnvironmentIdState((current) => {
      if (current !== "" && items.some((item) => item.id === current)) {
        return current;
      }
      return fallback.id;
    });
  }, [environmentQuery.data]);

  // 存储的对账关系已失效时回退到第一个启用关系
  useEffect(() => {
    const items = pairQuery.data;
    if (items === undefined || items.length === 0) {
      return;
    }
    const first = items[0];
    if (first === undefined) {
      return;
    }
    const fallback =
      items.find((item) => item.pairStatus === "ACTIVE") ?? first;
    setPairIdState((current) => {
      if (current !== "" && items.some((item) => item.id === current)) {
        return current;
      }
      return fallback.id;
    });
  }, [pairQuery.data]);

  useEffect(() => {
    if (environmentId !== "") {
      window.localStorage.setItem(ENV_STORAGE_KEY, environmentId);
    }
  }, [environmentId]);

  useEffect(() => {
    if (pairId !== "") {
      window.localStorage.setItem(PAIR_STORAGE_KEY, pairId);
    }
  }, [pairId]);

  const setEnvironmentId = useCallback((id: string) => {
    setEnvironmentIdState(id);
    window.localStorage.setItem(ENV_STORAGE_KEY, id);
  }, []);

  const setPairId = useCallback((id: string) => {
    setPairIdState(id);
    window.localStorage.setItem(PAIR_STORAGE_KEY, id);
  }, []);

  const setUiMode = useCallback((mode: UiMode) => {
    setUiModeState(mode);
    window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  }, []);

  const value: ScopeValue = {
    environments,
    environmentId: environmentId === "" ? undefined : environmentId,
    environment: environments.find((item) => item.id === environmentId),
    environmentsLoading: environmentQuery.isLoading,
    businessEnvironmentId: businessEnvironment?.id,
    businessEnvironment,
    pairs,
    pairId: pairId === "" ? undefined : pairId,
    pair: pairs.find((item) => item.id === pairId),
    pairsLoading: pairQuery.isLoading,
    uiMode,
    isAdvanced: uiMode === "advanced",
    setUiMode,
    setEnvironmentId,
    setPairId
  };

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const value = useContext(ScopeContext);
  if (value === null) {
    throw new Error("useScope 必须在 ScopeProvider 内使用");
  }
  return value;
}

/** 业务页面使用：业务模式固定默认环境，避免误用高级模式选中的环境。 */
export function useBusinessScope(): ScopeValue {
  const scope = useScope();
  if (scope.isAdvanced) {
    return scope;
  }
  return {
    ...scope,
    environmentId: scope.businessEnvironmentId,
    environment: scope.businessEnvironment
  };
}
