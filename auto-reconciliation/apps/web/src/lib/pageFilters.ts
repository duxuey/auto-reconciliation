import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { currentMonthPeriod, periodFromSearch, type DatePeriod } from "./period";
import { useBusinessScope } from "./scope";
import { trpc } from "./trpc";

/**
 * 业务页面统一的当前范围：URL 优先，其次沿用全局选择；
 * 期间依次取 URL、该对账关系最近一次执行、当前自然月。
 */
export function usePageFilters() {
  const { pairId: scopePairId, environmentId, isAdvanced, setPairId } =
    useBusinessScope();
  const [searchParams] = useSearchParams();
  const urlPairId = searchParams.get("pairId");
  const urlPairIdValue = urlPairId === "" ? null : urlPairId;

  useEffect(() => {
    if (urlPairIdValue !== null && urlPairIdValue !== scopePairId) {
      setPairId(urlPairIdValue);
    }
  }, [urlPairIdValue, scopePairId, setPairId]);

  const pairId = urlPairIdValue ?? scopePairId;
  const urlEnvironmentId = searchParams.get("environmentId");
  const effectiveEnvironmentId =
    isAdvanced && urlEnvironmentId !== null && urlEnvironmentId !== ""
      ? urlEnvironmentId
      : environmentId;

  const urlPeriod = useMemo(
    () => periodFromSearch(searchParams.toString()),
    [searchParams]
  );

  const latestRun = trpc.run.list.useQuery(
    { pairId: pairId ?? "", environmentId: effectiveEnvironmentId, limit: 1 },
    { enabled: pairId !== undefined && urlPeriod === undefined }
  );
  const latestPeriod = latestRun.data?.[0]?.run;

  const period: DatePeriod = useMemo(
    () =>
      urlPeriod ?? {
        periodStartDate: latestPeriod?.periodStartDate ?? currentMonthPeriod().periodStartDate,
        periodEndDate: latestPeriod?.periodEndDate ?? currentMonthPeriod().periodEndDate
      },
    [urlPeriod, latestPeriod?.periodStartDate, latestPeriod?.periodEndDate]
  );

  return {
    pairId,
    environmentId: effectiveEnvironmentId,
    period,
    isAdvanced,
    searchParams
  };
}
