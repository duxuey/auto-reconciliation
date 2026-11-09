import { METRIC_SQL_MAX_LENGTH } from "@infra/biz-reconciliation-engine";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { Badge, ResultBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Field, Input } from "../components/ui/input";
import { SelectMenu } from "../components/ui/select-menu";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { useToast } from "../components/ui/toast";
import { cn } from "../lib/cn";
import { friendlyError } from "../lib/errors";
import { formatDate } from "../lib/format";
import {
  CHECK_STAGE_LABELS,
  METRIC_TYPE_LABELS,
  PACK_STATUS_LABELS,
  PACK_VERSION_STATUS_LABELS,
  labelOf
} from "../lib/labels";
import {
  addMetricToComparison,
  allMetricCodes,
  countMetrics,
  datasetRefLabel,
  diffMetricChanges,
  nextMetricCode,
  readPackConfig,
  removeMetricFromComparison,
  updateMetricSql,
  type MetricChanges,
  type PackComparisonConfig,
  type PackConfig,
  type PackMetricConfig
} from "../lib/pack-config";
import { useScope, type PairOption } from "../lib/scope";
import { trpc } from "../lib/trpc";

const METRIC_TYPE_OPTIONS = Object.entries(METRIC_TYPE_LABELS).map(([value, label]) => ({
  value,
  label
}));
const MONEY_PATTERN = /^-?\d+(\.\d{1,4})?$/;
const METRIC_CODE_PATTERN = /^M\d{3}$/;

interface Pack {
  id: string;
  packCode: string;
  packName: string;
  checkStage: string;
  pairId: string | null;
  packStatus: string;
  currentVersionId: string | null;
  description: string | null;
}

interface PackVersionRow {
  id: string;
  versionNo: number;
  versionStatus: string;
  configJson: unknown;
  sourceScripts: string[];
  publishedBy: string | null;
  publishedAt: string | Date | null;
}

type ConfirmState =
  | { kind: "save" }
  | { kind: "publish"; versionId: string; versionNo: number };

function splitList(value: string): string[] {
  return value
    .split(/[,，;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function metricParams(metric: PackMetricConfig): string {
  if (metric.type === "AMOUNT_FIELDS") {
    return metric.fields === undefined || metric.fields.length === 0
      ? "-"
      : metric.fields.join("、");
  }
  if (metric.type === "RATE_FIELD") {
    return metric.rateField === undefined || metric.rateField === ""
      ? "-"
      : `汇率字段 ${metric.rateField}`;
  }
  if (metric.type === "SOURCE_ANOMALY") {
    const anomaly = metric.sourceAnomaly;
    if (anomaly === undefined) {
      return "-";
    }
    const side = metric.side === "LEFT" ? "左侧" : "右侧";
    if (anomaly.mode === "NOT_IN") {
      const allowed = (anomaly.allowed ?? []).join("、");
      return `${side} · ${anomaly.field} 不在 ${allowed === "" ? "-" : allowed}`;
    }
    return `${side} · ${anomaly.field} 去重数 ≤ ${anomaly.maxDistinct ?? "-"}`;
  }
  if (metric.fields !== undefined && metric.fields.length > 0) {
    return metric.fields.join("、");
  }
  return "-";
}

function formatTolerance(metric: PackMetricConfig): string {
  const tolerance = metric.tolerance;
  if (tolerance === undefined) {
    return "默认 0.00";
  }
  return tolerance.rel === undefined
    ? tolerance.abs
    : `${tolerance.abs} / 相对 ${tolerance.rel}`;
}

function RuleSummary({ comparison }: { comparison: PackComparisonConfig }) {
  const raw = comparison as Record<string, unknown>;
  const bits: string[] = [];
  if (Array.isArray(raw.filters) && raw.filters.length > 0) {
    bits.push(`过滤条件 ${raw.filters.length} 条`);
  }
  const normalize = raw.normalize;
  if (typeof normalize === "object" && normalize !== null && !Array.isArray(normalize)) {
    const fields = normalize as { trim?: unknown; upper?: unknown };
    const count =
      (Array.isArray(fields.trim) ? fields.trim.length : 0) +
      (Array.isArray(fields.upper) ? fields.upper.length : 0);
    if (count > 0) {
      bits.push(`归一化字段 ${count} 个`);
    }
  }
  const leftRules = Array.isArray(raw.leftRules) ? raw.leftRules.length : 0;
  const rightRules = Array.isArray(raw.rightRules) ? raw.rightRules.length : 0;
  if (leftRules + rightRules > 0) {
    bits.push(`金额方向规则 ${leftRules + rightRules} 条`);
  }
  if (raw.zeroSkip !== undefined) {
    bits.push("启用零值跳过");
  }
  if (raw.currency !== undefined) {
    bits.push("启用币种校验");
  }
  return (
    <div>
      比对规则：
      <span className="text-slate-600">{bits.length === 0 ? "无额外规则" : bits.join(" · ")}</span>
    </div>
  );
}

function ComparisonSection({
  comparison,
  onAdd,
  onRemove,
  onEditSql
}: {
  comparison: PackComparisonConfig;
  onAdd: () => void;
  onRemove: (metricIndex: number) => void;
  onEditSql: (metricIndex: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-800">
              {comparison.name ?? comparison.code}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
              {comparison.code}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>
              左：
              <span className="font-mono text-slate-600">
                {datasetRefLabel(comparison.leftDataset)}
              </span>
            </span>
            <span className="text-slate-300">→</span>
            <span>
              右：
              <span className="font-mono text-slate-600">
                {datasetRefLabel(comparison.rightDataset)}
              </span>
            </span>
            <span>{comparison.metrics.length} 个指标</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd}>
          + 新增指标
        </Button>
      </div>

      <Table>
        <thead>
          <tr>
            <Th className="w-24">指标代码</Th>
            <Th>指标名称</Th>
            <Th className="w-28">类型</Th>
            <Th>字段 / 参数</Th>
            <Th className="w-36">容差</Th>
            <Th className="w-28">SQL 口径</Th>
            <Th className="w-20">操作</Th>
          </tr>
        </thead>
        <tbody>
          {comparison.metrics.length === 0 ? (
            <EmptyRow colSpan={7}>该比对暂无指标</EmptyRow>
          ) : (
            comparison.metrics.map((metric, index) => (
              <tr key={`${metric.code}-${index}`} className="hover:bg-slate-50">
                <Td className="font-mono text-xs text-slate-600">{metric.code || "-"}</Td>
                <Td className="text-sm">{metric.name || "-"}</Td>
                <Td>
                  <Badge tone="neutral">
                    {labelOf(METRIC_TYPE_LABELS, metric.type, metric.type || "-")}
                  </Badge>
                </Td>
                <Td className="text-xs text-slate-500">{metricParams(metric)}</Td>
                <Td className="text-xs tabular-nums text-slate-500">
                  {formatTolerance(metric)}
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 px-2 text-xs",
                      typeof metric.sql === "string" && metric.sql.trim() !== ""
                        ? "text-blue-600 hover:bg-blue-50"
                        : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    )}
                    aria-label={`编辑指标 ${metric.code} 的 SQL 口径`}
                    title="仅作文档/审计说明，不参与执行"
                    onClick={() => onEditSql(index)}
                  >
                    {typeof metric.sql === "string" && metric.sql.trim() !== ""
                      ? "查看/编辑"
                      : "未填写"}
                  </Button>
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50"
                    disabled={comparison.metrics.length <= 1}
                    title={
                      comparison.metrics.length <= 1
                        ? "每组比对至少保留一个指标"
                        : "移除后需点击“保存并发布”才会生效"
                    }
                    onClick={() => onRemove(index)}
                  >
                    移除
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      <details className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-700">
          业务键与比对说明
        </summary>
        <div className="mt-2 space-y-1">
          <div>
            业务键：
            <span className="font-mono text-slate-600">
              {comparison.keyFields.length === 0 ? "-" : comparison.keyFields.join("、")}
            </span>
          </div>
          <RuleSummary comparison={comparison} />
        </div>
      </details>
    </div>
  );
}

function AddMetricDialog({
  open,
  onOpenChange,
  comparisonName,
  existingCodes,
  suggestedCode,
  onAdd
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparisonName: string;
  existingCodes: string[];
  suggestedCode: string | null;
  onAdd: (metric: PackMetricConfig) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("ROW_COUNT");
  const [fields, setFields] = useState("");
  const [abs, setAbs] = useState("0.00");
  const [rel, setRel] = useState("");
  const [side, setSide] = useState("RIGHT");
  const [mode, setMode] = useState("NOT_IN");
  const [anomalyField, setAnomalyField] = useState("");
  const [allowed, setAllowed] = useState("");
  const [maxDistinct, setMaxDistinct] = useState("10");
  const [rateField, setRateField] = useState("");
  const [sql, setSql] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCode(suggestedCode ?? "");
    setName("");
    setType("ROW_COUNT");
    setFields("");
    setAbs("0.00");
    setRel("");
    setSide("RIGHT");
    setMode("NOT_IN");
    setAnomalyField("");
    setAllowed("");
    setMaxDistinct("10");
    setRateField("");
    setSql("");
    setError(null);
  }, [open, suggestedCode]);

  function handleSubmit(): void {
    const trimmedCode = code.trim();
    if (!METRIC_CODE_PATTERN.test(trimmedCode)) {
      setError("指标代码必须为 M + 三位数字，例如 M004。");
      return;
    }
    if (existingCodes.includes(trimmedCode)) {
      setError(`指标代码 ${trimmedCode} 已存在，请使用其他代码。`);
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setError("请填写指标名称。");
      return;
    }
    const fieldList = splitList(fields);
    if (type === "AMOUNT_FIELDS" && fieldList.length === 0) {
      setError("金额字段指标至少需要填写一个字段。");
      return;
    }
    if (type === "RATE_FIELD" && rateField.trim() === "") {
      setError("汇率指标需要填写汇率字段。");
      return;
    }
    if (type === "SOURCE_ANOMALY") {
      if (anomalyField.trim() === "") {
        setError("来源异常指标需要填写检查字段。");
        return;
      }
      if (mode === "NOT_IN" && splitList(allowed).length === 0) {
        setError("NOT_IN 模式需要填写允许值清单。");
        return;
      }
      if (mode === "DISTINCT_GT") {
        const parsed = Number(maxDistinct);
        if (!Number.isInteger(parsed) || parsed < 1) {
          setError("去重上限必须为大于 0 的整数。");
          return;
        }
      }
    }
    const trimmedAbs = abs.trim();
    if (!MONEY_PATTERN.test(trimmedAbs)) {
      setError("绝对值容差必须是最多 4 位小数的数字，例如 0.00。");
      return;
    }
    const trimmedRel = rel.trim();
    if (trimmedRel !== "" && !MONEY_PATTERN.test(trimmedRel)) {
      setError("相对容差必须是最多 4 位小数的数字。");
      return;
    }
    if (sql.length > METRIC_SQL_MAX_LENGTH) {
      setError(`SQL 口径最多 ${METRIC_SQL_MAX_LENGTH} 个字符。`);
      return;
    }

    const metric: PackMetricConfig = {
      code: trimmedCode,
      name: trimmedName,
      type
    };
    if (fieldList.length > 0) {
      metric.fields = fieldList;
    }
    metric.tolerance =
      trimmedRel === "" ? { abs: trimmedAbs } : { abs: trimmedAbs, rel: trimmedRel };
    if (type === "RATE_FIELD") {
      metric.rateField = rateField.trim();
    }
    if (type === "SOURCE_ANOMALY") {
      metric.side = side === "LEFT" ? "LEFT" : "RIGHT";
      metric.sourceAnomaly =
        mode === "NOT_IN"
          ? {
              mode: "NOT_IN",
              field: anomalyField.trim(),
              allowed: splitList(allowed)
            }
          : {
              mode: "DISTINCT_GT",
              field: anomalyField.trim(),
              maxDistinct: Number(maxDistinct)
            };
    }
    if (sql.trim() !== "") {
      metric.sql = sql;
    }
    onAdd(metric);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增指标</DialogTitle>
          <DialogDescription>
            在比对「{comparisonName}」中新增指标；保存并发布后，下一次执行开始使用。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="指标代码" hint="格式为 M + 三位数字">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="M004"
              className="font-mono"
            />
          </Field>
          <Field label="指标类型">
            <SelectMenu
              ariaLabel="指标类型"
              value={type}
              options={METRIC_TYPE_OPTIONS}
              onChange={setType}
              className="h-9"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="指标名称">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：每条记录对应金额是否一致"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              label="比对字段（可选）"
              hint="多个字段用逗号分隔；金额字段指标必填"
            >
              <Input
                value={fields}
                onChange={(event) => setFields(event.target.value)}
                placeholder="item_amnt, item_rmb_amnt"
                className="font-mono"
              />
            </Field>
          </div>
          <Field label="绝对值容差" hint="最多 4 位小数">
            <Input
              value={abs}
              onChange={(event) => setAbs(event.target.value)}
              className="font-mono tabular-nums"
            />
          </Field>
          <Field label="相对容差（可选）" hint="留空表示只比较绝对值">
            <Input
              value={rel}
              onChange={(event) => setRel(event.target.value)}
              placeholder="0.001"
              className="font-mono tabular-nums"
            />
          </Field>

          {type === "RATE_FIELD" ? (
            <div className="sm:col-span-2">
              <Field label="汇率字段">
                <Input
                  value={rateField}
                  onChange={(event) => setRateField(event.target.value)}
                  placeholder="rate"
                  className="font-mono"
                />
              </Field>
            </div>
          ) : null}

          {type === "SOURCE_ANOMALY" ? (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2 sm:grid-cols-2">
              <Field label="检查侧">
                <SelectMenu
                  ariaLabel="检查侧"
                  value={side}
                  options={[
                    { value: "RIGHT", label: "右侧" },
                    { value: "LEFT", label: "左侧" }
                  ]}
                  onChange={setSide}
                  className="h-9"
                />
              </Field>
              <Field label="检查模式">
                <SelectMenu
                  ariaLabel="检查模式"
                  value={mode}
                  options={[
                    { value: "NOT_IN", label: "允许值清单（NOT_IN）" },
                    { value: "DISTINCT_GT", label: "去重上限（DISTINCT_GT）" }
                  ]}
                  onChange={setMode}
                  className="h-9"
                />
              </Field>
              <Field label="检查字段">
                <Input
                  value={anomalyField}
                  onChange={(event) => setAnomalyField(event.target.value)}
                  placeholder="bsns_src"
                  className="font-mono"
                />
              </Field>
              {mode === "NOT_IN" ? (
                <Field label="允许值" hint="多个值用逗号分隔">
                  <Input
                    value={allowed}
                    onChange={(event) => setAllowed(event.target.value)}
                    placeholder="4000000"
                    className="font-mono"
                  />
                </Field>
              ) : (
                <Field label="最大去重数">
                  <Input
                    value={maxDistinct}
                    onChange={(event) => setMaxDistinct(event.target.value)}
                    className="font-mono tabular-nums"
                  />
                </Field>
              )}
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <Field
              label="SQL 口径（可选，仅作文档/审计）"
              hint="系统不会执行该 SQL；留空则不记录。"
            >
              <Textarea
                rows={5}
                value={sql}
                onChange={(event) => setSql(event.target.value)}
                maxLength={METRIC_SQL_MAX_LENGTH}
                spellCheck={false}
                placeholder="SELECT ..."
                className="font-mono text-xs"
              />
            </Field>
          </div>
        </div>

        {error === null ? null : (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit}>新增指标</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function describeMetricChanges(changes: MetricChanges | null): string {
  if (changes === null) {
    return "无指标差异";
  }
  const parts: string[] = [];
  if (changes.added > 0) {
    parts.push(`新增 ${changes.added} 个指标`);
  }
  if (changes.removed > 0) {
    parts.push(`移除 ${changes.removed} 个指标`);
  }
  if (changes.modified > 0) {
    parts.push(`修改 ${changes.modified} 个指标 SQL`);
  }
  return parts.length === 0 ? "无指标差异" : parts.join("、");
}

function MetricSqlDialog({
  open,
  onOpenChange,
  comparisonName,
  metric,
  onApply
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparisonName: string;
  metric: PackMetricConfig | undefined;
  onApply: (sql: string) => void;
}) {
  const [sql, setSql] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSql(metric?.sql ?? "");
    setError(null);
  }, [open, metric]);

  function handleApply(): void {
    if (sql.length > METRIC_SQL_MAX_LENGTH) {
      setError(`SQL 口径最多 ${METRIC_SQL_MAX_LENGTH} 个字符。`);
      return;
    }
    onApply(sql);
  }

  const metricLabel =
    metric === undefined ? "-" : `${metric.code || "-"} · ${metric.name || "未命名指标"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>指标 SQL 口径</DialogTitle>
          <DialogDescription>
            比对「{comparisonName}」· {metricLabel}。仅用于文档与审计说明；系统不会执行该
            SQL，也不会影响指标计算。应用后需点击「保存并发布」生成新版本。
          </DialogDescription>
        </DialogHeader>

        <Field
          label="SQL 口径（可选）"
          hint={`留空表示移除该说明；最多 ${METRIC_SQL_MAX_LENGTH} 个字符。`}
        >
          <Textarea
            rows={16}
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            maxLength={METRIC_SQL_MAX_LENGTH}
            spellCheck={false}
            placeholder="SELECT ..."
            className="font-mono text-xs"
          />
        </Field>
        <div className="mt-1 text-right text-[11px] tabular-nums text-slate-400">
          {sql.length} / {METRIC_SQL_MAX_LENGTH}
        </div>

        {error === null ? null : (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleApply}>应用修改</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PackPanel({ pack }: { pack: Pack }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const versionsQuery = trpc.pack.versions.useQuery({ id: pack.id });
  const createVersion = trpc.pack.createVersion.useMutation();
  const publish = trpc.pack.publish.useMutation();

  const [expanded, setExpanded] = useState(true);
  const [edited, setEdited] = useState<PackConfig | null>(null);
  const [addMetricIndex, setAddMetricIndex] = useState<number | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configPreview, setConfigPreview] = useState<unknown>(null);
  const [sqlTarget, setSqlTarget] = useState<{
    comparisonIndex: number;
    metricIndex: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const versions: PackVersionRow[] = versionsQuery.data ?? [];
  const currentVersion =
    versions.find((version) => version.id === pack.currentVersionId) ?? versions[0];
  const baseConfig =
    currentVersion === undefined ? null : readPackConfig(currentVersion.configJson);
  const config = edited ?? baseConfig;
  const changes =
    baseConfig !== null && edited !== null ? diffMetricChanges(baseConfig, edited) : null;
  const dirty =
    changes !== null && changes.added + changes.removed + changes.modified > 0;
  const addTarget = addMetricIndex === null ? undefined : config?.comparisons[addMetricIndex];
  const sqlComparison =
    sqlTarget === null ? undefined : config?.comparisons[sqlTarget.comparisonIndex];
  const sqlMetric =
    sqlComparison === undefined || sqlTarget === null
      ? undefined
      : sqlComparison.metrics[sqlTarget.metricIndex];
  const publishVersionNo =
    confirmState !== null && confirmState.kind === "publish" ? confirmState.versionNo : null;

  function removeMetric(comparisonIndex: number, metricIndex: number): void {
    if (config === null) {
      return;
    }
    setEdited(removeMetricFromComparison(config, comparisonIndex, metricIndex));
    setSaveError(null);
  }

  function addMetric(metric: PackMetricConfig): void {
    if (config === null || addMetricIndex === null) {
      return;
    }
    setEdited(addMetricToComparison(config, addMetricIndex, metric));
    setAddMetricIndex(null);
    setSaveError(null);
  }

  function applyMetricSql(sql: string): void {
    if (config === null || sqlTarget === null) {
      return;
    }
    setEdited(updateMetricSql(config, sqlTarget.comparisonIndex, sqlTarget.metricIndex, sql));
    setSqlTarget(null);
    setSaveError(null);
  }

  async function runConfirm(): Promise<void> {
    if (confirmState === null) {
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      if (confirmState.kind === "save") {
        if (edited === null || currentVersion === undefined) {
          return;
        }
        const created = await createVersion.mutateAsync({
          packId: pack.id,
          config: edited,
          sourceScripts: currentVersion.sourceScripts
        });
        try {
          await publish.mutateAsync({
            packId: pack.id,
            versionId: created.id,
            dryRun: false,
            confirm: true
          });
          setEdited(null);
          toast.success(`已发布 v${created.versionNo}，指标变更将在下次执行生效。`);
        } catch (error) {
          setEdited(null);
          await utils.pack.versions.invalidate({ id: pack.id });
          setSaveError(
            `新版本 v${created.versionNo} 已保存为草稿，可在「版本历史」中重试发布。${friendlyError(error, true)}`
          );
          return;
        }
      } else {
        await publish.mutateAsync({
          packId: pack.id,
          versionId: confirmState.versionId,
          dryRun: false,
          confirm: true
        });
        toast.success(`版本 v${confirmState.versionNo} 已发布。`);
      }
      setConfirmState(null);
      await utils.pack.versions.invalidate({ id: pack.id });
      await utils.pack.list.invalidate();
    } catch (error) {
      setConfirmState(null);
      setSaveError(friendlyError(error, true));
    } finally {
      setBusy(false);
    }
  }

  const versionLabel =
    currentVersion === undefined
      ? "无版本"
      : `${labelOf(PACK_VERSION_STATUS_LABELS, currentVersion.versionStatus)} v${currentVersion.versionNo}`;

  return (
    <Card className={cn("bg-white", dirty && "ring-1 ring-amber-300")}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <button
          type="button"
          aria-label={`${expanded ? "收起" : "展开"}指标包 ${pack.packName}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((state) => !state)}
          className="mt-0.5 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={cn("h-4 w-4 transition-transform", expanded ? "rotate-90" : undefined)}
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{pack.packName}</span>
            <span className="font-mono text-[11px] text-slate-400">{pack.packCode}</span>
            <Badge tone="info">{labelOf(CHECK_STAGE_LABELS, pack.checkStage)}</Badge>
            <ResultBadge
              result={pack.packStatus}
              label={labelOf(PACK_STATUS_LABELS, pack.packStatus)}
            />
            <span className="text-[11px] text-slate-500">{versionLabel}</span>
            {config === null ? null : (
              <span className="text-[11px] text-slate-500">
                · {config.comparisons.length} 组比对 · {countMetrics(config)} 个指标
              </span>
            )}
          </div>
          {pack.description === null || pack.description === "" ? null : (
            <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">
              {pack.description}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {dirty ? <Badge tone="warning">有未保存修改</Badge> : null}
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            版本历史
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/40 p-3">
          <QueryState isLoading={versionsQuery.isLoading} error={versionsQuery.error}>
            {baseConfig === null || config === null || currentVersion === undefined ? (
              <EmptyState
                title="该指标包暂无配置版本"
                description="没有可展示的比对与指标配置，请先在后台导入指标包版本。"
              />
            ) : (
              <div className="space-y-3">
                {currentVersion.versionStatus !== "PUBLISHED" ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    当前展示的是草稿版本 v{currentVersion.versionNo}，尚未发布；执行不会使用该配置。
                  </div>
                ) : null}

                {saveError === null ? null : (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {saveError}
                  </div>
                )}

                {config.comparisons.map((comparison, index) => (
                  <ComparisonSection
                    key={`${comparison.code}-${index}`}
                    comparison={comparison}
                    onAdd={() => setAddMetricIndex(index)}
                    onRemove={(metricIndex) => removeMetric(index, metricIndex)}
                    onEditSql={(metricIndex) =>
                      setSqlTarget({ comparisonIndex: index, metricIndex })
                    }
                  />
                ))}

                {edited === null ? null : (
                  <div
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2",
                      dirty
                        ? "border-amber-200 bg-amber-50"
                        : "border-slate-200 bg-white"
                    )}
                  >
                    <span className="text-xs text-slate-700">
                      {dirty
                        ? `待发布变更：${describeMetricChanges(changes)}`
                        : "修改后与当前指标一致，无需保存"}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEdited(null);
                          setSqlTarget(null);
                          setSaveError(null);
                        }}
                      >
                        放弃修改
                      </Button>
                      <Button
                        size="sm"
                        disabled={!dirty}
                        onClick={() => setConfirmState({ kind: "save" })}
                      >
                        保存并发布
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </QueryState>
        </div>
      ) : null}

      {addTarget === undefined || config === null ? null : (
        <AddMetricDialog
          open={addMetricIndex !== null}
          onOpenChange={(open) => {
            if (!open) {
              setAddMetricIndex(null);
            }
          }}
          comparisonName={addTarget.name ?? addTarget.code}
          existingCodes={allMetricCodes(config)}
          suggestedCode={nextMetricCode(config)}
          onAdd={addMetric}
        />
      )}

      {config === null || sqlComparison === undefined || sqlMetric === undefined ? null : (
        <MetricSqlDialog
          open={sqlTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSqlTarget(null);
            }
          }}
          comparisonName={sqlComparison.name ?? sqlComparison.code}
          metric={sqlMetric}
          onApply={applyMetricSql}
        />
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pack.packName} · 版本历史</DialogTitle>
            <DialogDescription>
              版本配置为不可变快照；发布后用于复现指标结果，旧版本自动停用。
            </DialogDescription>
          </DialogHeader>
          <QueryState isLoading={versionsQuery.isLoading} error={versionsQuery.error}>
            <Table>
              <thead>
                <tr>
                  <Th>版本</Th>
                  <Th>状态</Th>
                  <Th>指标数</Th>
                  <Th>发布人</Th>
                  <Th>发布时间</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {versions.length === 0 ? (
                  <EmptyRow colSpan={6}>暂无版本</EmptyRow>
                ) : (
                  versions.map((version) => {
                    const versionConfig = readPackConfig(version.configJson);
                    return (
                      <tr key={version.id} className="hover:bg-slate-50">
                        <Td>
                          v{version.versionNo}
                          {version.id === pack.currentVersionId ? (
                            <span className="ml-2 text-[11px] text-blue-600">当前</span>
                          ) : null}
                        </Td>
                        <Td>
                          <ResultBadge
                            result={version.versionStatus}
                            label={labelOf(
                              PACK_VERSION_STATUS_LABELS,
                              version.versionStatus
                            )}
                          />
                        </Td>
                        <Td>{versionConfig === null ? "-" : countMetrics(versionConfig)}</Td>
                        <Td className="text-xs">{version.publishedBy ?? "-"}</Td>
                        <Td className="text-xs text-slate-500">
                          {formatDate(version.publishedAt)}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setHistoryOpen(false);
                                setConfigPreview(version.configJson);
                              }}
                            >
                              查看配置
                            </Button>
                            {version.versionStatus === "DRAFT" ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  setConfirmState({
                                    kind: "publish",
                                    versionId: version.id,
                                    versionNo: version.versionNo
                                  })
                                }
                              >
                                发布
                              </Button>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </QueryState>
        </DialogContent>
      </Dialog>

      <Dialog
        open={configPreview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfigPreview(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指标包规则配置</DialogTitle>
            <DialogDescription>版本配置为不可变快照，发布后用于复现指标结果</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-[11px] leading-5 text-slate-100">
            {JSON.stringify(configPreview, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmState !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setConfirmState(null);
          }
        }}
        title={
          confirmState === null || confirmState.kind === "save"
            ? "保存指标变更并发布"
            : `发布版本 v${publishVersionNo ?? "-"}`
        }
        description={
          confirmState !== null && confirmState.kind === "publish" ? (
            "发布后当前版本自动停用，新版本用于后续执行；历史结果仍按原版本口径保留。"
          ) : (
            <>
              将基于 v{currentVersion?.versionNo ?? "-"} 创建新版本：
              {describeMetricChanges(changes)}。指标 SQL 口径仅作文档与审计说明，不参与执行。
              发布后当前版本自动停用，下一次执行开始使用新配置。
            </>
          )
        }
        confirmLabel={confirmState !== null && confirmState.kind === "publish" ? "确认发布" : "保存并发布"}
        busy={busy}
        onConfirm={() => {
          void runConfirm();
        }}
      />
    </Card>
  );
}

interface PackGroup {
  key: string;
  pair: PairOption | undefined;
  packs: Pack[];
}

export function PacksPage() {
  const { pairs } = useScope();
  const packsQuery = trpc.pack.list.useQuery({});
  const [pairFilter, setPairFilter] = useState("");

  const pairOptions = useMemo(
    () => [
      { value: "", label: "全部对账关系" },
      ...pairs.map((pair) => ({ value: pair.id, label: pair.pairName }))
    ],
    [pairs]
  );

  const visiblePacks = useMemo(
    () =>
      (packsQuery.data ?? []).filter(
        (pack) => pairFilter === "" || pack.pairId === pairFilter
      ),
    [packsQuery.data, pairFilter]
  );

  const groups = useMemo<PackGroup[]>(() => {
    const knownPairs = new Set(pairs.map((pair) => pair.id));
    const result: PackGroup[] = [];
    for (const pair of pairs) {
      const items = visiblePacks.filter((pack) => pack.pairId === pair.id);
      if (items.length > 0) {
        result.push({ key: pair.id, pair, packs: items });
      }
    }
    const orphans = visiblePacks.filter(
      (pack) => pack.pairId === null || !knownPairs.has(pack.pairId)
    );
    if (orphans.length > 0) {
      result.push({ key: "__unbound", pair: undefined, packs: orphans });
    }
    return result;
  }, [pairs, visiblePacks]);

  return (
    <div>
      <PageHeader
        title="指标管理"
        description="按系统间对账关系查看指标包与指标明细；指标 SQL 口径仅作文档/审计说明，不参与执行。新增、移除指标或修改 SQL 口径会生成新版本，确认发布后生效。"
        actions={
          <div className="w-64">
            <SelectMenu
              ariaLabel="对账关系筛选"
              value={pairFilter}
              options={pairOptions}
              onChange={setPairFilter}
            />
          </div>
        }
      />

      <QueryState isLoading={packsQuery.isLoading} error={packsQuery.error}>
        {groups.length === 0 ? (
          <EmptyState
            title="暂无可管理的指标包"
            description="当前筛选下没有指标包；可在环境配置中确认对账关系，或检查指标包是否已导入。"
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <Card key={group.key}>
                <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>
                      {group.pair?.pairName ?? "未绑定对账关系"}
                    </CardTitle>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {group.pair === undefined
                        ? "指标包未关联对账关系"
                        : `${group.pair.leftSystemName} → ${group.pair.rightSystemName}`}
                    </div>
                  </div>
                  <Badge tone="neutral">{group.packs.length} 个指标包</Badge>
                </CardHeader>
                <CardContent className="space-y-3 bg-slate-50/40">
                  {group.packs.map((pack) => (
                    <PackPanel key={pack.id} pack={pack} />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
