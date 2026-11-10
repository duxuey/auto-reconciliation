import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, Input, Select } from "../components/ui/input";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { EmptyRow, Table, Td, Th } from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import { PACK_STATUS_LABELS, labelOf } from "../lib/labels";
import { useScope, type EnvironmentOption } from "../lib/scope";
import { trpc } from "../lib/trpc";

const DEFAULT_PORT = "3306";
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface EnvironmentEditState {
  id: string;
  envCode: string;
  envName: string;
  dbHost: string;
  dbPort: string;
  dbUser: string;
  dbPasswordEnvKey: string;
  defaultDatabase: string;
}

interface SchemaEntry {
  key: string;
  value: string;
}

interface SchemaDraft {
  environmentId: string;
  systemCode: string;
  connectionLimit: string;
  entries: SchemaEntry[];
  isNew: boolean;
}

export function SettingsPage() {
  const utils = trpc.useUtils();
  const { environments } = useScope();
  const systems = trpc.system.list.useQuery();
  const pairs = trpc.pair.list.useQuery();

  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    envCode: "",
    envName: "",
    dbHost: "",
    dbPort: DEFAULT_PORT,
    dbUser: "",
    dbPasswordEnvKey: "LEGACY_MYSQL_PASSWORD",
    defaultDatabase: ""
  });

  const [editingEnv, setEditingEnv] = useState<EnvironmentEditState | null>(null);
  const envSystems = trpc.environment.systems.useQuery(
    { id: editingEnv?.id ?? "" },
    { enabled: editingEnv !== null }
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [schemaDraft, setSchemaDraft] = useState<SchemaDraft | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaNotice, setSchemaNotice] = useState<string | null>(null);
  const [deletingEnv, setDeletingEnv] = useState<EnvironmentOption | null>(null);
  const [deletingSystem, setDeletingSystem] = useState<{
    id: string;
    systemCode: string;
    systemName: string;
  } | null>(null);

  const createEnvironment = trpc.environment.create.useMutation({
    onSuccess: async (created) => {
      const createdCode = form.envCode;
      await utils.environment.list.invalidate();
      setMessage(`环境 ${createdCode} 已创建，可继续配置系统 schema`);
      setForm({
        envCode: "",
        envName: "",
        dbHost: "",
        dbPort: DEFAULT_PORT,
        dbUser: "",
        dbPasswordEnvKey: "LEGACY_MYSQL_PASSWORD",
        defaultDatabase: ""
      });
      startEditEnvironment(created);
    },
    onError: (error) => setMessage(error.message)
  });

  const updateEnvironment = trpc.environment.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.environment.list.invalidate(),
        utils.workbench.readiness.invalidate()
      ]);
      setEditingEnv(null);
      setSchemaDraft(null);
      setSchemaNotice(null);
      setMessage("环境配置已保存");
    },
    onError: (error) => {
      setMessage(error.message);
      setEditError(error.message);
    }
  });

  const testConnection = trpc.environment.testConnection.useMutation({
    onSuccess: (result) => setMessage(result.message),
    onError: (error) => setMessage(error.message)
  });

  const upsertSystem = trpc.environment.upsertSystem.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.environment.systems.invalidate(),
        utils.workbench.readiness.invalidate()
      ]);
      setSchemaDraft(null);
      setSchemaError(null);
      setSchemaNotice("系统 schema 已保存");
    },
    onError: (error) => setSchemaError(error.message)
  });

  const deleteEnvironment = trpc.environment.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.environment.list.invalidate(),
        utils.environment.systems.invalidate(),
        utils.workbench.readiness.invalidate()
      ]);
      setDeletingEnv(null);
      setMessage("环境已删除");
    },
    onError: (error) => {
      setDeletingEnv(null);
      setMessage(error.message);
    }
  });

  const deleteSystem = trpc.environment.deleteSystem.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.environment.systems.invalidate(),
        utils.workbench.readiness.invalidate()
      ]);
      setDeletingSystem(null);
      setMessage("系统 schema 配置已删除");
    },
    onError: (error) => {
      setDeletingSystem(null);
      setMessage(error.message);
    }
  });

  function startEditEnvironment(item: EnvironmentOption): void {
    setEditError(null);
    setSchemaDraft(null);
    setSchemaError(null);
    setSchemaNotice(null);
    setEditingEnv({
      id: item.id,
      envCode: item.envCode,
      envName: item.envName,
      dbHost: item.dbHost,
      dbPort: String(item.dbPort),
      dbUser: item.dbUser,
      dbPasswordEnvKey: item.dbPasswordEnvKey,
      defaultDatabase: item.defaultDatabase ?? ""
    });
  }

  function saveEnvironment(): void {
    if (editingEnv === null) {
      return;
    }
    const port = Number(editingEnv.dbPort);
    if (
      editingEnv.envName.trim() === "" ||
      editingEnv.dbHost.trim() === "" ||
      editingEnv.dbUser.trim() === "" ||
      editingEnv.dbPasswordEnvKey.trim() === ""
    ) {
      setEditError("环境名称、主机、数据库账号、密码环境变量名不能为空");
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setEditError("端口需为 1-65535 的整数");
      return;
    }
    if (!ENV_KEY_PATTERN.test(editingEnv.dbPasswordEnvKey.trim())) {
      setEditError(
        "「密码环境变量名」只能包含字母、数字、下划线且不能以数字开头；请填写环境变量名（如 SIT_MYSQL_PASSWORD），而不是密码本身"
      );
      return;
    }
    updateEnvironment.mutate({
      id: editingEnv.id,
      envName: editingEnv.envName.trim(),
      dbHost: editingEnv.dbHost.trim(),
      dbPort: port,
      dbUser: editingEnv.dbUser.trim(),
      dbPasswordEnvKey: editingEnv.dbPasswordEnvKey.trim(),
      defaultDatabase: editingEnv.defaultDatabase.trim()
    });
  }

  function openSchemaEditor(systemCode?: string): void {
    if (editingEnv === null) {
      return;
    }
    const configured = envSystems.data ?? [];
    const systemCodes = (systems.data ?? []).map((item) => item.systemCode);
    // 未指定系统时优先打开尚未配置的系统；全部已配置则打开第一个已配置系统进行编辑，
    // 避免以空映射覆盖已保存的 schema。
    const targetCode =
      systemCode ??
      systemCodes.find(
        (code) => !configured.some((entry) => entry.systemCode === code)
      ) ??
      configured[0]?.systemCode ??
      systemCodes[0];
    const existing = configured.find((item) => item.systemCode === targetCode);
    const entries =
      existing === undefined
        ? [{ key: "DEFAULT", value: "" }]
        : Object.entries(existing.schemaMap).map(([key, value]) => ({ key, value }));
    setSchemaError(null);
    setSchemaNotice(null);
    setSchemaDraft({
      environmentId: editingEnv.id,
      systemCode: targetCode ?? "",
      connectionLimit: String(existing?.connectionLimit ?? 5),
      entries: entries.length === 0 ? [{ key: "DEFAULT", value: "" }] : entries,
      isNew: existing === undefined
    });
  }

  function updateSchemaEntry(index: number, patch: Partial<SchemaEntry>): void {
    setSchemaDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            entries: current.entries.map((entry, entryIndex) =>
              entryIndex === index ? { ...entry, ...patch } : entry
            )
          }
    );
  }

  function saveSchemaDraft(): void {
    if (schemaDraft === null) {
      return;
    }
    if (schemaDraft.systemCode === "") {
      setSchemaError("请选择系统");
      return;
    }
    const limit = Number(schemaDraft.connectionLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      setSchemaError("连接数需为 1-50 的整数");
      return;
    }
    const schemaMap: Record<string, string> = {};
    for (const entry of schemaDraft.entries) {
      const key = entry.key.trim().toUpperCase();
      const value = entry.value.trim();
      if (key === "" || value === "") {
        setSchemaError("schema 键与 schema 名称不能为空");
        return;
      }
      if (schemaMap[key] !== undefined) {
        setSchemaError(`schema 键 ${key} 重复`);
        return;
      }
      schemaMap[key] = value;
    }
    if (Object.keys(schemaMap).length === 0) {
      setSchemaError("请至少保留一个 schema 映射");
      return;
    }
    upsertSystem.mutate({
      environmentId: schemaDraft.environmentId,
      systemCode: schemaDraft.systemCode,
      schemaMap,
      connectionLimit: limit
    });
  }

  function submitCreateEnvironment(): void {
    if (!ENV_KEY_PATTERN.test(form.dbPasswordEnvKey.trim())) {
      setMessage(
        "「密码环境变量名」只能包含字母、数字、下划线且不能以数字开头；请填写环境变量名（如 SIT_MYSQL_PASSWORD），而不是密码本身"
      );
      return;
    }
    createEnvironment.mutate({
      envCode: form.envCode,
      envName: form.envName,
      dbHost: form.dbHost,
      dbPort: Number(form.dbPort),
      dbUser: form.dbUser,
      dbPasswordEnvKey: form.dbPasswordEnvKey,
      defaultDatabase: form.defaultDatabase === "" ? undefined : form.defaultDatabase,
      isDefault: false
    });
  }

  return (
    <div>
      <PageHeader
        title="环境与系统配置"
        description="环境连接信息存于数据库，密码只保存环境变量名；系统 schema 在新增或修改环境时一并维护"
      />

      {message === null ? null : (
        <div className="mb-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          {message}
        </div>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>新增环境</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="环境编码">
              <Input
                value={form.envCode}
                placeholder="UAT"
                onChange={(event) =>
                  setForm({ ...form, envCode: event.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="环境名称">
              <Input
                value={form.envName}
                placeholder="验收环境"
                onChange={(event) => setForm({ ...form, envName: event.target.value })}
              />
            </Field>
            <Field label="主机">
              <Input
                value={form.dbHost}
                onChange={(event) => setForm({ ...form, dbHost: event.target.value })}
              />
            </Field>
            <Field label="端口">
              <Input
                value={form.dbPort}
                onChange={(event) => setForm({ ...form, dbPort: event.target.value })}
              />
            </Field>
            <Field label="数据库账号">
              <Input
                value={form.dbUser}
                onChange={(event) => setForm({ ...form, dbUser: event.target.value })}
              />
            </Field>
            <Field label="密码环境变量名" hint="填写环境变量名，如 SIT_MYSQL_PASSWORD；实际密码在 .env 中配置">
              <Input
                value={form.dbPasswordEnvKey}
                onChange={(event) =>
                  setForm({ ...form, dbPasswordEnvKey: event.target.value })
                }
              />
            </Field>
            <Field label="默认库（可空）">
              <Input
                value={form.defaultDatabase}
                onChange={(event) => setForm({ ...form, defaultDatabase: event.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              创建后自动打开编辑面板，可继续维护该环境的系统 schema。
            </p>
            <Button
              disabled={createEnvironment.isPending}
              onClick={submitCreateEnvironment}
            >
              {createEnvironment.isPending ? "创建中…" : "创建环境"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>环境</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryState isLoading={false} error={null}>
            <Table>
              <thead>
                <tr>
                  <Th>编码</Th>
                  <Th>名称</Th>
                  <Th>连接</Th>
                  <Th>密码变量</Th>
                  <Th>状态</Th>
                  <Th>默认</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {environments.length === 0 ? (
                  <EmptyRow colSpan={7}>暂无环境</EmptyRow>
                ) : (
                  environments.map((item) => (
                    <tr key={item.id}>
                      <Td className="font-mono text-xs">{item.envCode}</Td>
                      <Td>{item.envName}</Td>
                      <Td className="text-xs">
                        {item.dbHost === "" ? (
                          <span className="text-slate-400">待配置</span>
                        ) : (
                          <span className="font-mono">
                            {item.dbHost}:{item.dbPort}/{item.defaultDatabase || "-"}
                          </span>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">
                        {item.dbPasswordEnvKey}
                        {ENV_KEY_PATTERN.test(item.dbPasswordEnvKey) ? null : (
                          <span className="ml-1 font-sans text-red-600">（应为变量名）</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={item.envStatus === "ACTIVE" ? "success" : "neutral"}>
                          {labelOf(PACK_STATUS_LABELS, item.envStatus)}
                        </Badge>
                      </Td>
                      <Td>{item.isDefault ? "是" : "-"}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEditEnvironment(item)}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={testConnection.isPending || item.dbHost === ""}
                            onClick={() => testConnection.mutate({ id: item.id })}
                          >
                            测试连接
                          </Button>
                          {item.isDefault ? null : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                updateEnvironment.mutate({ id: item.id, isDefault: true })
                              }
                            >
                              设为默认
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              updateEnvironment.mutate({
                                id: item.id,
                                envStatus: item.envStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE"
                              })
                            }
                          >
                            {item.envStatus === "ACTIVE" ? "停用" : "启用"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:bg-red-50"
                            disabled={item.isDefault}
                            title={item.isDefault ? "默认环境不能删除" : undefined}
                            onClick={() => setDeletingEnv(item)}
                          >
                            删除
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>对账关系</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>编码</Th>
                <Th>名称</Th>
                <Th>系统</Th>
                <Th>指标包</Th>
                <Th>状态</Th>
                <Th>说明</Th>
              </tr>
            </thead>
            <tbody>
              {(pairs.data ?? []).length === 0 ? (
                <EmptyRow colSpan={6}>暂无对账关系</EmptyRow>
              ) : (
                (pairs.data ?? []).map((item) => (
                  <tr key={item.id}>
                    <Td className="font-mono text-xs">{item.pairCode}</Td>
                    <Td>{item.pairName}</Td>
                    <Td className="text-xs">
                      {item.leftSystemName} ↔ {item.rightSystemName}
                    </Td>
                    <Td>{item.packCount}</Td>
                    <Td>
                      <Badge tone={item.pairStatus === "ACTIVE" ? "success" : "neutral"}>
                        {labelOf(PACK_STATUS_LABELS, item.pairStatus)}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-slate-500">{item.description ?? "-"}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={editingEnv !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingEnv(null);
            setEditError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑环境 {editingEnv?.envCode ?? ""}</DialogTitle>
            <DialogDescription>
              环境编码创建后不可修改；密码仍只保存环境变量名，实际值由部署环境注入。系统 schema 在下方维护。
            </DialogDescription>
          </DialogHeader>
          {editingEnv === null ? null : (
            <div className="space-y-3">
              {editError === null ? null : (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {editError}
                </div>
              )}
              <Field label="环境编码">
                <Input value={editingEnv.envCode} disabled />
              </Field>
              <Field label="环境名称">
                <Input
                  value={editingEnv.envName}
                  onChange={(event) =>
                    setEditingEnv({ ...editingEnv, envName: event.target.value })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="主机">
                  <Input
                    value={editingEnv.dbHost}
                    onChange={(event) =>
                      setEditingEnv({ ...editingEnv, dbHost: event.target.value })
                    }
                  />
                </Field>
                <Field label="端口">
                  <Input
                    value={editingEnv.dbPort}
                    onChange={(event) =>
                      setEditingEnv({ ...editingEnv, dbPort: event.target.value })
                    }
                  />
                </Field>
                <Field label="数据库账号">
                  <Input
                    value={editingEnv.dbUser}
                    onChange={(event) =>
                      setEditingEnv({ ...editingEnv, dbUser: event.target.value })
                    }
                  />
                </Field>
                <Field label="密码环境变量名" hint="填写环境变量名，如 SIT_MYSQL_PASSWORD；实际密码在 .env 中配置">
                  <Input
                    value={editingEnv.dbPasswordEnvKey}
                    onChange={(event) =>
                      setEditingEnv({ ...editingEnv, dbPasswordEnvKey: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="默认库（可空）">
                <Input
                  value={editingEnv.defaultDatabase}
                  onChange={(event) =>
                    setEditingEnv({ ...editingEnv, defaultDatabase: event.target.value })
                  }
                />
              </Field>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">
                      环境系统 schema
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      数据集按 schemaKey 查找对应 schema，未命中时使用 DEFAULT；修改后立即影响直连源库解析。
                    </p>
                  </div>
                  {schemaDraft === null ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(systems.data ?? []).length === 0}
                      onClick={() => openSchemaEditor()}
                    >
                      配置系统 schema
                    </Button>
                  ) : null}
                </div>

                {schemaNotice === null ? null : (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {schemaNotice}
                  </div>
                )}

                <QueryState isLoading={envSystems.isLoading} error={envSystems.error}>
                  <Table>
                    <thead>
                      <tr>
                        <Th>系统</Th>
                        <Th>schema 映射</Th>
                        <Th>连接数</Th>
                        <Th>操作</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(envSystems.data ?? []).length === 0 ? (
                        <EmptyRow colSpan={4}>该环境尚未配置系统</EmptyRow>
                      ) : (
                        (envSystems.data ?? []).map((item) => (
                          <tr key={item.id}>
                            <Td className="text-xs">
                              <div className="font-mono">{item.systemCode}</div>
                              <div className="text-slate-500">{item.systemName}</div>
                            </Td>
                            <Td className="font-mono text-xs">
                              {Object.entries(item.schemaMap).map(([key, value]) => (
                                <div key={key}>
                                  {key} → {value}
                                </div>
                              ))}
                            </Td>
                            <Td>{item.connectionLimit}</Td>
                            <Td>
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openSchemaEditor(item.systemCode)}
                                >
                                  编辑
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:bg-red-50"
                                  onClick={() =>
                                    setDeletingSystem({
                                      id: item.id,
                                      systemCode: item.systemCode,
                                      systemName: item.systemName
                                    })
                                  }
                                >
                                  删除
                                </Button>
                              </div>
                            </Td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </Table>
                </QueryState>

                {schemaDraft === null ? null : (
                  <div className="space-y-3 rounded-lg border border-blue-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-800">
                      {schemaDraft.isNew
                        ? "新增系统 schema"
                        : `编辑系统 schema · ${schemaDraft.systemCode}`}
                    </div>
                    {schemaError === null ? null : (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {schemaError}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="系统">
                        <Select
                          value={schemaDraft.systemCode}
                          disabled={!schemaDraft.isNew}
                          onChange={(event) =>
                            setSchemaDraft({ ...schemaDraft, systemCode: event.target.value })
                          }
                        >
                          {(systems.data ?? []).map((item) => (
                            <option key={item.id} value={item.systemCode}>
                              {item.systemCode} · {item.systemName}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="连接数">
                        <Input
                          value={schemaDraft.connectionLimit}
                          onChange={(event) =>
                            setSchemaDraft({
                              ...schemaDraft,
                              connectionLimit: event.target.value
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-600">schema 映射</div>
                      {schemaDraft.entries.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            className="w-32"
                            aria-label="schema 键"
                            placeholder="DEFAULT"
                            value={entry.key}
                            onChange={(event) =>
                              updateSchemaEntry(index, {
                                key: event.target.value.toUpperCase()
                              })
                            }
                          />
                          <span className="text-xs text-slate-400">→</span>
                          <Input
                            aria-label="schema 名称"
                            placeholder="fpic_clm_db"
                            value={entry.value}
                            onChange={(event) =>
                              updateSchemaEntry(index, { value: event.target.value })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={schemaDraft.entries.length <= 1}
                            onClick={() =>
                              setSchemaDraft({
                                ...schemaDraft,
                                entries: schemaDraft.entries.filter(
                                  (_, entryIndex) => entryIndex !== index
                                )
                              })
                            }
                          >
                            删除
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSchemaDraft({
                            ...schemaDraft,
                            entries: [...schemaDraft.entries, { key: "", value: "" }]
                          })
                        }
                      >
                        新增映射
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={upsertSystem.isPending}
                        onClick={saveSchemaDraft}
                      >
                        {upsertSystem.isPending ? "保存中…" : "保存 schema"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSchemaDraft(null);
                          setSchemaError(null);
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button disabled={updateEnvironment.isPending} onClick={saveEnvironment}>
                  {updateEnvironment.isPending ? "保存中…" : "保存修改"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingEnv(null);
                    setEditError(null);
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deletingEnv !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingEnv(null);
          }
        }}
        title={`删除环境 ${deletingEnv?.envCode ?? ""}`}
        description="删除后该环境的连接信息与系统 schema 配置将不再可用。默认环境、被自动对账使用的环境，以及已有批次或执行记录的环境不能删除（后者请改为停用）。"
        confirmLabel="删除环境"
        tone="danger"
        busy={deleteEnvironment.isPending}
        onConfirm={() => {
          if (deletingEnv !== null) {
            deleteEnvironment.mutate({ id: deletingEnv.id });
          }
        }}
      />

      <ConfirmDialog
        open={deletingSystem !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingSystem(null);
          }
        }}
        title={`删除系统 schema ${deletingSystem?.systemCode ?? ""}`}
        description={`删除后 ${deletingSystem?.systemName ?? ""} 在当前环境下的 schema 映射将失效，绑定该系统的数据集直连时会提示「源库未配置」。`}
        confirmLabel="删除配置"
        tone="danger"
        busy={deleteSystem.isPending}
        onConfirm={() => {
          if (deletingSystem !== null) {
            deleteSystem.mutate({ id: deletingSystem.id });
          }
        }}
      />
    </div>
  );
}
