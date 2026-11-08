# 业再财自动对账系统

按《合约账和临分账的自动对账机制专题需求沟通会议纪要》与《自动对账指标》SQL 口径建设的独立对账平台。

> 工程根目录：`D:\work\project\auto-reconciliation\auto-reconciliation`。
> 规范、会议纪要、指标 SQL 与 `ri-service` / `ri-web` 位于**上层目录** `D:\work\project\auto-reconciliation\`，与本工程同级。

## 能力

- 指标包：承保↔再保、理赔↔再保（主表/共保/临分分入/险别）、再保送收付↔收付账单
- 指标类型：条数、业务键数、单边缺失、同键记录数、重复、来源异常、金额字段逐项、汇率
- 闭环：执行时直连源库读取 → 指标执行 → 汇总 → 差异明细 → 处理 → 系统间闸门 → 报表
- 每日自动对账：按自然日调度，自动执行全部启用关系的前一天（T-1）对账，结果推送企业微信
- 口径严格对齐既有 SQL：`metric_code / metric_name / check_result / total_count / fail_count`

### 范围边界（2026-10-29 确认）

- **做**：承保/理赔/收付 ↔ 再保的系统间对账；生产通过只读 MySQL 抽取。
- **不做**：精算/准备金对账、财务全辖对账、`承保与再保（旧）` 指标、ri-web 集成。
- **数据量**：暂不限制（`MAX_RUN_ROWS=0`），后续再做配置管控。
- **集成**：后续集成到新核心系统，本期不接 ri-web。

详细设计见 [自动对账系统设计方案.md](./自动对账系统设计方案.md)。

## 技术栈

TypeScript strict + Node 24 + pnpm；Hono + tRPC + Drizzle + PostgreSQL 16；React 18 + Vite + shadcn 风格组件 + TanStack Query/Table；vitest + Playwright。

## 本地启动

> 前置：Node.js ≥ 24、pnpm 12（Node 24 自带 corepack；本机已放置 pnpm shim）、本地 PostgreSQL 16。

### 1. 启动 PostgreSQL

本机使用免安装版 PostgreSQL 16（默认数据目录 `D:\work\tools\pgdata`）：

```bash
# 首次初始化（仅执行一次）
D:/work/tools/pgsql/bin/initdb -D D:/work/tools/pgdata -U postgres -A trust -E UTF8 --locale=C

# 启动 / 停止
D:/work/tools/pgsql/bin/pg_ctl.exe -D D:/work/tools/pgdata -l D:/work/tools/pg.log -o "-p 5432" start
D:/work/tools/pgsql/bin/pg_ctl.exe -D D:/work/tools/pgdata stop

# 首次创建业务库（仅执行一次）
D:/work/tools/pgsql/bin/createdb -h 127.0.0.1 -p 5432 -U postgres db_biz_reconciliation
```

### 2. 准备环境变量

```bash
cp .env.example .env   # 按本机修改 DATABASE_URL
```

默认连接：`postgresql://postgres@127.0.0.1:5432/db_biz_reconciliation`。

### 3. 安装依赖并初始化数据库

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm seed
```

### 4. 启动开发服务（两个终端分别执行）

```bash
pnpm dev:api          # API：http://127.0.0.1:3100（健康检查 /health）
pnpm dev:web          # Web：http://127.0.0.1:5173
```

启动后可验证：

```bash
curl http://127.0.0.1:3100/health   # {"status":"ok","service":"biz-reconciliation",...}
```

> 日常开发（依赖已安装、数据库已初始化且种子数据未变）只需：启动 PostgreSQL → 分别运行 `pnpm dev:api` 与 `pnpm dev:web`。

## 页面入口

打开 `http://127.0.0.1:5173` 默认进入**业务模式**，业务人员无需接触指标包、SQL 或环境配置：

- `/` 对账工作台：选择对账关系与期间 → 数据就绪检查 → 一键对账 → 查看结果 → 处理差异 → 阶段确认与报表。
- 业务导航：对账工作台、执行记录、差异处理、调整建议、阶段确认、对账报表、自动对账；环境固定为默认环境。
- 左下角勾选「高级模式」后追加：运营总览、指标包、数据接入、环境配置，并显示环境/对账关系下拉。
- 旧地址 `/packs`、`/datasets`、`/settings` 会自动重定向到 `/advanced/*`；`/advanced/automation` 重定向到 `/automation`。

## 直连源库对账

「对账工作台」的「开始对账」与「自动对账」都在**执行时直连源库**，不再要求先导入或同步数据：

- **数据源解析**：按「环境 × 系统」严格解析数据集所属实例与 schema；环境必须启用、系统必须绑定、
  `schemaMap` 必须命中 `schemaKey` 或 `DEFAULT`，密码只通过环境变量名引用。
  PROD 未配置时直接报错，**不会回退到 `LEGACY_MYSQL_*`**，避免误读本地库。
- **密码变量名**：「密码环境变量名」只接受 POSIX 变量名（如 `SIT_MYSQL_PASSWORD`），不能填密码本身；
  实际值在部署环境的 `.env` 中设置，修改后需重启 API。「测试连接」在变量未配置时会直接给出提示。
- **期间抽取**：抽取 SQL 使用半开区间 `>= 开始日 AND < 结束日 + 1 天`，因此单日 T-1 也能正确取数。
- **批次落库与复用**：抽取结果写入当次 `import_batch` + `staging_record`，保留差异来源钻取与审计；
  按「数据集 + 映射 + 数据源 + 期间 + 内容哈希」复用批次。源数据未变化时重复执行复用同一批次/执行，
  内容变化才生成新批次；每次执行只加载 `manifest.batchIds` 声明的批次，后续抽取不会污染历史结果。
- **无数据语义**：任一侧有数据仍执行（产生缺失差异）；所有数据集都为 0 行时标记「源库期间内无数据」；
  连接/配置错误记为失败并给出脱敏原因，不会被伪装成无数据。
- **文件数据集**：仍通过工作台「上传文件」接入；高级模式「数据接入」保留手动读库同步，
  仅作为预检或补数工具，不是对账前置条件。
- **边界**：工作台请求内同步完成抽取，T-1 数据量可控；大区间补跑可能较慢，后续可改为抽取作业 + 轮询。

## 每日自动对账与企业微信

业务导航 →「自动对账」（`/automation`）配置：

- **调度**：启用后按自然日（不跳过周末）在指定 `HH:mm` 执行，对账期间为执行日的前一天（T-1），
  逐个串行执行全部 `ACTIVE` 对账关系；每个关系执行时按期间直连源库抽取，无需预先导入或同步。
  源库在该期间没有数据的关系会标注「源库期间内无数据」；连接/配置失败则记为失败并给出脱敏原因。
- **补跑与幂等**：服务启动时若当天执行时间已过且尚无记录，会补跑一次；同一调度日以
  `daily:<日期>` 唯一键去重，重启不会重复执行。补跑失败不自动反复重试。
- **通知渠道**：企业微信群机器人 Webhook、飞书/钉钉群机器人（发到群并 @ 指定成员）、
  企业应用消息（CorpID/AgentID/Secret/接收人），或组合发送；页面可发送测试通知。
  通知失败只记录在执行记录中，不影响对账状态。
- **密钥**：数据库只保存环境变量名（默认 `WECOM_WEBHOOK_URL`、`WECOM_APP_SECRET`），实际值由
  部署环境注入；API 与页面只显示「已配置 / 未配置」，不返回值、不打印日志。
  飞书/钉钉机器人复用 Webhook 环境变量名，@ 接收人填在「接收人」：飞书填 open_id，
  钉钉填手机号或 userid，`all` 表示 @所有人。钉钉机器人安全设置为「加签」时，还需在
  「加签密钥环境变量名」填写存放 `SEC...` 密钥的环境变量名（如 `DINGTALK_ROBOT_SECRET`），
  发送时会自动追加 `timestamp` 与 `sign`；选「自定义关键词」/IP 白名单时该变量可不配置。
- **手动执行**：可指定期间区间补跑，用于验证或补数；执行记录支持轮询查看每关系明细、
  未通过指标与实际发送的消息内容。
- **单进程**：调度器随 API 进程运行，当前仅支持单实例部署；多实例需后续引入数据库锁或持久队列。

本地验证：先在 `.env` 配置可用的源库只读账号（或使用 TEST 环境已配置的实例），确保环境×系统的
`schemaMap` 与源库一致 → 在 `.env` 填入 `WECOM_WEBHOOK_URL`（或应用参数）→ 打开页面保存并「测试通知」
→ 手动执行 `2026-10-01 ~ 2026-10-31` 确认批次与消息 → 将执行时间设为 2 分钟后保存，
观察执行记录自动新增。

> 源库不可用时，工作台与自动对账会返回「读取源库失败」的脱敏提示（不含 host/账号/密码/SQL）；
> 种子 CSV 仅用于文件数据集与 `pnpm test:oracle`，不再作为直连数据集的数据来源。

## 验证

```bash
pnpm typecheck
pnpm lint                 # ESLint + repo-lint（表前缀/错误码/业务词/SQL 红线）
pnpm test                 # 引擎指标单测 + API 错误码/状态机/种子配置测试
pnpm test:oracle          # 种子数据指标快照对拍（需先 pnpm seed）
pnpm test:e2e             # Playwright（使用本机 Chrome）
pnpm contracts:extract    # 路由契约机械投影到 docs/contracts/
```

## 当前实现范围

- 指标引擎：ROW_COUNT / KEY_COUNT / MISSING_LEFT / MISSING_RIGHT / MISSING_BOTH /
  RECORD_COUNT_PER_KEY / DUPLICATE_LEFT / DUPLICATE_RIGHT / SOURCE_ANOMALY /
  AMOUNT_FIELDS / RATE_FIELD
- 环境与系统：环境（TEST/PROD 可扩展）与连接信息存 PG，密码仅存环境变量名；已保存的环境连接
  与 schema 映射可在「环境配置」直接编辑或删除（环境编码创建后不可修改；默认环境、自动对账正在
  使用、已有批次/执行记录的环境不可删除，可改为停用）；同一 MySQL 实例下
  按「环境 × 系统」配置 schema 映射；数据集绑定系统与 schemaKey，抽取 SQL 使用 `{{schema}}` 占位
- 系统对账关系（7 个）：非车承保↔非车理赔、车承保↔车理赔、车承保↔再保、非车承保↔再保、
  非车理赔↔再保、车理赔↔再保、再保↔收付；首页与顶栏均可切换当前对账关系，指标包按对账关系归属
- 指标包（7 个、55 项）：
  - `NB_UW_CLM_GENERIC` 非车承保↔非车理赔通用指标（7 项，待按表结构细化）
  - `UW_RI_FAC` 临分分入承保↔再保（11 项）
  - `CLM_RI_MAIN` 常规理赔↔再保（11 项）
  - `CLM_RI_COINS` 非车共保↔再保（9 项）
  - `CLM_RI_FAC` 临分分入理赔↔再保（11 项）
  - `CLM_RI_CVRG` 险别赔款/费用↔再保（3 项）
  - `RP_RI` 再保送收付↔收付账单（3 项）
- 闭环：数据集映射、执行时直连源库抽取/文件导入、执行批次（幂等/可重放/可取消）、作业记录与 jobId 轮询、
  指标汇总、差异明细与源记录钻取、指派/调查/解决/核销/备注、调整建议（生成/提交/审批/驳回/导出）、
  系统间闸门、概览/指标/账龄报表
- 业务工作台：六步引导（对账关系与期间、数据源检查、一键对账、执行结果、差异处理、阶段确认与报表）；
  一键对账先直连源库读取期间数据，再按对账关系聚合所有数据就绪的指标包；重复执行复用未变化的批次
- 高级设置：运营总览、指标包规则、数据接入（手动读库预检/文件导入）、环境与系统配置
- 业务导航「自动对账」：每日定时（自然日）/启动补跑/手动执行，全部启用关系 T-1 串行对账，
  结果汇总推送企业微信（群机器人 Webhook / 企业应用消息）或飞书/钉钉机器人（@ 指定成员），执行记录可追溯
- 样例：`fixtures/datasets` 四端 CSV；`fixtures/expected/seed-summary.json` 为 SQL 口径快照

## 目录

```text
D:\work\project\auto-reconciliation\
├─ 工程规范约束.md  技术选型-通用原则与清单.md   （输入规范）
├─ 20240624_需求沟通_...docx                    （会议纪要）
├─ 自动对账指标/                                （既有 SQL 口径，只读参照）
├─ ri-service/  ri-web/                         （既有工程，不修改）
└─ auto-reconciliation/                         （本工程根目录）
   ├─ apps/api        Hono + tRPC + Drizzle + 指标引擎接入
   ├─ apps/web        React 运营台
   ├─ packages/engine Money / Time / 指标 DSL / 指标引擎
   ├─ packages/adapters/file             CSV/JSON 导入
   ├─ packages/adapters/legacy-mysql     只读抽取（登记 SQL）
   ├─ docs/           规范偏差登记、契约投影
   ├─ fixtures/       四端样例数据与期望指标快照
   ├─ 自动对账系统设计方案.md
   └─ README.md
```

## 尚未覆盖 / 下一阶段

- 新核心系统表结构：车承保/车理赔（及承保↔理赔细化指标）待提供后，在「环境配置」中补充 schema
  映射与抽取 SQL，再配置对应指标包
- 生产直连联调：14 个数据集抽取 SQL 已登记（`{{schema}}` 占位）且均绑定抽取 profile，需在生产环境填写
  连接信息、配置 `PROD_MYSQL_PASSWORD` 等环境变量，并在真实库验证字段与过滤条件、只读账号权限
- 真实 MySQL 源表的 SQL 对拍；性能压测（数据量暂不限制，引擎为内存分桶）
- 指标包/版本创建与发布 UI；差异处理/调整建议/手动读库的写操作 E2E
- 高级模式「创建执行批次」（单包）仍依赖暂存数据；本期只改造业务工作台与自动对账
- Job 持久队列/SKIP LOCKED/失败重试/细粒度进度/水平扩展（当前为进程内异步 + 重启回收）
- 自动对账单进程调度：多实例部署需改为数据库 advisory lock 或持久队列；暂无节假日日历
- 请求/响应 JSON Schema 投影与契约测试
- 完整偏差与替换路径见 [docs/规范偏差登记.md](./docs/规范偏差登记.md)
