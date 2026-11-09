import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, Input } from "../components/ui/input";
import { SelectMenu } from "../components/ui/select-menu";
import { TimePicker } from "../components/ui/time-picker";
import { useToast } from "../components/ui/toast";
import { friendlyError } from "../lib/errors";
import { formatDate } from "../lib/format";
import { AUTOMATION_CHANNEL_LABELS } from "../lib/labels";
import { useScope } from "../lib/scope";
import { trpc } from "../lib/trpc";

type Channel = "WEBHOOK" | "APP" | "BOTH" | "ROBOT";

interface ConfigForm {
  enabled: boolean;
  runTime: string;
  channel: Channel;
  environmentId: string;
  webhookUrlEnvKey: string;
  appCorpId: string;
  appAgentId: string;
  appSecretEnvKey: string;
  toUser: string;
}

export function AutomationSettingsPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { environments } = useScope();
  const configQuery = trpc.automation.getConfig.useQuery();
  const [form, setForm] = useState<ConfigForm | null>(null);

  useEffect(() => {
    const data = configQuery.data;
    if (data === undefined || form !== null) {
      return;
    }
    setForm({
      enabled: data.enabled,
      runTime: data.runTime,
      channel: data.channel,
      environmentId: data.environmentId,
      webhookUrlEnvKey: data.webhookUrlEnvKey,
      appCorpId: data.appCorpId ?? "",
      appAgentId: data.appAgentId ?? "",
      appSecretEnvKey: data.appSecretEnvKey,
      toUser: data.toUser ?? ""
    });
  }, [configQuery.data, form]);

  const updateConfig = trpc.automation.updateConfig.useMutation({
    onSuccess: async (result) => {
      setForm({
        enabled: result.enabled,
        runTime: result.runTime,
        channel: result.channel,
        environmentId: result.environmentId,
        webhookUrlEnvKey: result.webhookUrlEnvKey,
        appCorpId: result.appCorpId ?? "",
        appAgentId: result.appAgentId ?? "",
        appSecretEnvKey: result.appSecretEnvKey,
        toUser: result.toUser ?? ""
      });
      toast.success("自动对账配置已保存");
      await utils.automation.getConfig.invalidate();
    },
    onError: (error) => toast.error(friendlyError(error, true))
  });

  const testNotify = trpc.automation.testNotify.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    },
    onError: (error) => toast.error(friendlyError(error, true))
  });

  const config = configQuery.data;

  function patchForm(patch: Partial<ConfigForm>): void {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }

  function saveConfig(): void {
    if (form === null) {
      return;
    }
    if (form.environmentId === "") {
      toast.error("请选择执行环境");
      return;
    }
    if (form.channel !== "APP" && form.webhookUrlEnvKey.trim() === "") {
      toast.error("请填写机器人 Webhook 环境变量名");
      return;
    }
    if (form.channel === "ROBOT") {
      if (form.toUser.trim() === "") {
        toast.error("请填写需要 @ 的接收人");
        return;
      }
    }
    if (form.channel === "APP" || form.channel === "BOTH") {
      if (form.appCorpId.trim() === "") {
        toast.error("请填写企业微信 CorpID");
        return;
      }
      if (form.appAgentId.trim() === "") {
        toast.error("请填写企业应用 AgentID");
        return;
      }
      if (!/^\d{1,10}$/.test(form.appAgentId.trim())) {
        toast.error("AgentID 必须为数字");
        return;
      }
      if (form.toUser.trim() === "") {
        toast.error("请填写接收人成员账号");
        return;
      }
    }
    updateConfig.mutate({
      enabled: form.enabled,
      runTime: form.runTime,
      channel: form.channel,
      environmentId: form.environmentId,
      webhookUrlEnvKey: form.webhookUrlEnvKey.trim(),
      appCorpId: form.appCorpId.trim() === "" ? undefined : form.appCorpId.trim(),
      appAgentId:
        form.appAgentId.trim() === "" ? undefined : form.appAgentId.trim(),
      appSecretEnvKey: form.appSecretEnvKey.trim(),
      toUser: form.toUser.trim() === "" ? undefined : form.toUser.trim()
    });
  }

  return (
    <div>
      <PageHeader
        title="自动对账配置"
        description="设置每日自动对账的执行时间、执行环境与通知渠道；密钥只保存环境变量名，由部署环境提供。"
      />

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>调度配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <QueryState isLoading={configQuery.isLoading} error={configQuery.error}>
            {form === null ? null : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        form.enabled ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    <span className="text-xs font-medium text-slate-700">
                      {form.enabled ? "自动对账已启用" : "自动对账未启用"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-2xs text-slate-500">
                      {AUTOMATION_CHANNEL_LABELS[form.channel] ?? form.channel}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">
                    下次执行：
                    {form.enabled
                      ? config?.nextRunAt === null || config?.nextRunAt === undefined
                        ? "保存后计算"
                        : formatDate(config.nextRunAt)
                      : "未启用"}
                  </span>
                </div>

                <section className="space-y-2.5">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <span className="h-3 w-0.5 rounded-full bg-blue-500" />
                    基本设置
                  </h3>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition hover:border-blue-300 hover:bg-blue-50/40">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-blue-600"
                      checked={form.enabled}
                      onChange={(event) => patchForm({ enabled: event.target.checked })}
                    />
                    <span>
                      <span className="block text-xs font-medium text-slate-700">
                        启用每日自动对账
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        按自然日执行，期间为前一天；服务重启后会补跑当天遗漏的一次。
                      </span>
                    </span>
                  </label>
                </section>

                <section className="space-y-2.5">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <span className="h-3 w-0.5 rounded-full bg-blue-500" />
                    执行计划
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="执行时间">
                      <TimePicker
                        ariaLabel="执行时间"
                        value={form.runTime}
                        onChange={(value) => patchForm({ runTime: value })}
                      />
                    </Field>
                    <Field label="执行环境">
                      <SelectMenu
                        ariaLabel="执行环境"
                        placeholder="请选择环境"
                        value={form.environmentId}
                        options={environments.map((item) => ({
                          value: item.id,
                          label: `${item.envCode} · ${item.envName}`
                        }))}
                        onChange={(value) => patchForm({ environmentId: value })}
                      />
                    </Field>
                  </div>
                </section>

                <div className="border-t border-slate-100" />

                <section className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <span className="h-3 w-0.5 rounded-full bg-blue-500" />
                      通知设置
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {form.channel !== "APP" ? (
                        <Badge
                          tone={config?.webhookConfigured === true ? "success" : "neutral"}
                        >
                          Webhook {config?.webhookConfigured === true ? "已配置" : "未配置"}
                        </Badge>
                      ) : null}
                      {form.channel === "ROBOT" ? (
                        <>
                          <Badge
                            tone={
                              config?.appSecretConfigured === true ? "success" : "neutral"
                            }
                          >
                            加签密钥{" "}
                            {config?.appSecretConfigured === true ? "已配置" : "未配置"}
                          </Badge>
                          <Badge
                            tone={form.toUser.trim() === "" ? "warning" : "success"}
                          >
                            @接收人 {form.toUser.trim() === "" ? "未填写" : "已填写"}
                          </Badge>
                        </>
                      ) : null}
                      {form.channel === "APP" || form.channel === "BOTH" ? (
                        <Badge
                          tone={
                            config?.appFieldsConfigured === true ? "success" : "neutral"
                          }
                        >
                          应用参数{" "}
                          {config?.appFieldsConfigured === true ? "已填写" : "未填写"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="通知渠道">
                      <SelectMenu
                        ariaLabel="通知渠道"
                        value={form.channel}
                        options={(["WEBHOOK", "ROBOT", "APP", "BOTH"] as const).map(
                          (code) => ({
                            value: code,
                            label: AUTOMATION_CHANNEL_LABELS[code] ?? code
                          })
                        )}
                        onChange={(value) =>
                          patchForm({ channel: value as Channel })
                        }
                      />
                    </Field>
                    <Field
                      label={
                        form.channel === "ROBOT"
                          ? "机器人 Webhook 环境变量名"
                          : "Webhook 环境变量名"
                      }
                    >
                      <Input
                        value={form.webhookUrlEnvKey}
                        onChange={(event) =>
                          patchForm({ webhookUrlEnvKey: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                </section>

                {form.channel === "ROBOT" ? (
                  <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="@ 接收人">
                        <Input
                          value={form.toUser}
                          placeholder="open_id / 手机号 / userid，多个用 | 分隔；all 表示 @所有人"
                          onChange={(event) => patchForm({ toUser: event.target.value })}
                        />
                      </Field>
                      <Field label="加签密钥环境变量名（可选）">
                        <Input
                          value={form.appSecretEnvKey}
                          placeholder="如 DINGTALK_ROBOT_SECRET，仅保存变量名"
                          onChange={(event) =>
                            patchForm({ appSecretEnvKey: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <p className="text-xs text-slate-500">
                      群机器人只能发到群并 @ 指定成员；密钥在执行时从部署环境读取。
                    </p>
                  </div>
                ) : null}

                {form.channel === "APP" || form.channel === "BOTH" ? (
                  <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="CorpID">
                        <Input
                          value={form.appCorpId}
                          onChange={(event) => patchForm({ appCorpId: event.target.value })}
                        />
                      </Field>
                      <Field label="AgentID（数字）">
                        <Input
                          value={form.appAgentId}
                          onChange={(event) => patchForm({ appAgentId: event.target.value })}
                        />
                      </Field>
                      <Field label="Secret 环境变量名">
                        <Input
                          value={form.appSecretEnvKey}
                          onChange={(event) =>
                            patchForm({ appSecretEnvKey: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="接收人（成员账号）">
                        <Input
                          value={form.toUser}
                          placeholder="userid，多个用 | 分隔"
                          onChange={(event) => patchForm({ toUser: event.target.value })}
                        />
                      </Field>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-500">
                      企业应用私聊需在企业微信后台创建自建应用，并把该成员加入应用可见范围；
                      接收人填写成员账号（userid），Secret 只保存环境变量名。
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-400">
                    保存后按新配置重新计算下次执行时间
                  </span>
                  <div className="flex gap-2">
                    <Button disabled={updateConfig.isPending} onClick={saveConfig}>
                      {updateConfig.isPending ? "保存中…" : "保存配置"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={testNotify.isPending}
                      onClick={() => testNotify.mutate()}
                    >
                      {testNotify.isPending ? "发送中…" : "测试通知"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
