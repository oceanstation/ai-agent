
# AGENTS.md — 仓库宪法

> 本文件是 **AI 编码助手（CodeBuddy / Claude Code / Codex 等）与新贡献者的强约束读物**，遵循 [agents.md](https://agents.md/) 事实标准。
> 针对 AI Coding，若无明确的"该怎么写"，会迅速产生风格漂移、虚假抽象、幽灵依赖。
> 修改本仓库任何代码前，请先完整通读一遍本文件。任何违反 **强制** 条款的 PR 一律不予合入。

### 术语约定（避免歧义）

本仓库里"Agent"一词有两层含义，通篇请按上下文区分：

| 术语 | 指代 | 出现场景 |
|---|---|---|
| **AI 编码助手** | 读本文件、替你写/改代码的外部工具（CodeBuddy / Claude Code / Codex / Cursor 等） | 本文件的**读者**；§6 全章 |
| **自研 Agent** / **`apps/agent`** | 本仓库交付的产品服务（NestJS + LangChain 实现的对话式智能体） | §0 项目介绍、§2 目录、§4 后端约定；作为**被开发对象** |

简单记忆：**AI 编码助手是写代码的人（工具），自研 Agent 是被写的产品。**
本文件的所有条款都是给"AI 编码助手 + 人类贡献者"看的开发守则，条款约束的是**如何开发本仓库**（包含自研 Agent 在内的所有代码），而不是"自研 Agent 运行时该怎么行为"。

---

## 0. 项目定位速览

- 类型：**Nx 23 + pnpm 9.15 monorepo**
- **自研 Agent 服务** `apps/agent` — NestJS 11 + LangChain 1.x（`createAgent`），对接 DeepSeek 兼容端点，通过 SSE 以 **ContentBlock** 协议向前端推送
- 前端：`apps/ui`（Vue 3.5 + Vite）、`apps/ui-astro`（Astro 5 岛屿，实验）
- 共享：`packages/common` — 前后端唯一契约层（`ContentBlock` 等类型）
- 运行时依赖：Node ≥ 22.5，使用 `--experimental-sqlite` 内置 SQLite
- 自研 Agent 的七大子系统：`llm / memory / skills / workspace / history / sdd / tools`；详见 `README.md`

修改任何一处之前，先在心里回答："这属于哪个应用/子系统？边界在哪里？"

---

## 1. 环境与工具链（强制）

| 项 | 值 | 说明 |
|---|---|---|
| 包管理器 | **pnpm 9.15+** | 由 `package.json#packageManager` 锁定；**禁止**使用 `npm` / `yarn` / `bun` |
| Node | **≥ 22.5** | 依赖 `node:sqlite`；升 Node 大版本需同步 CI 与 README |
| 构建编排 | **Nx 23** | 新增项目必须挂到 `nx.json` / `pnpm-workspace.yaml`，不得游离 |
| TS 配置 | 继承 `tsconfig.base.json` | 禁止在项目里独立设置 `target` / `moduleResolution` |
| 代码风格 | `eslint.config.mjs` + `.prettierrc` | 所有代码必须通过 `pnpm lint`；不要在文件里塞 `eslint-disable` 除非在 PR 描述里说明理由 |
| 分支 | 主干 `main`；PR 合并 | 禁止直推 `main` |

**允许**：`pnpm nx run ...`、`pnpm nx affected -t ...`、`pnpm dev` / `pnpm agent:serve` / `pnpm ui:dev` 等 `package.json` 中已定义的 script。

**禁止**：
- 直接 `node xxx.ts` 绕过 Nx executor 启动服务
- 引入新的 monorepo 编排工具（Turborepo / Rush / Lerna）
- 全局安装依赖，任何依赖都必须显式登记到对应 `package.json`

---

## 2. 目录与模块边界（强制）

自研 Agent 服务（`apps/agent`）内部结构：

```
apps/agent/src/app/agent/
├── llm/         # 模型分层（fast / pro）
├── memory/      # 长期记忆
├── skills/      # SKILL.md 渐进披露
├── workspace/   # 沙箱文件读写 + 命令白名单
├── history/     # SQLite + FTS5 会话历史
├── sdd/         # 规约驱动开发状态机
├── tools/       # LangChain 工具工厂
├── knowledge/   # 知识库（向量检索）
├── bootstrap/   # 启动自检
└── config/      # 系统提示词 + MCP 配置
```

### 2.1 模块间通信规则

- **`apps/agent` 与 `apps/ui` / `apps/ui-astro` 只能通过 `packages/common` 通信**；任何一方直接 `import` 对方源码 → **拒绝合入**
- **自研 Agent 的子系统之间通过各自 Service 显式依赖**，不得跨越模块直接读文件系统 / SQLite / 环境变量
- **`tools/*` 只允许调用同项目 Service**，不得反向被 Service 依赖（工具是"末端"）
- 新增子系统 → 建独立目录 + `xxx.module.ts` + `xxx.service.ts` + `xxx.types.ts`（+ 可选 `xxx.config.ts`）

### 2.2 命名约定

| 类型 | 命名 | 示例 |
|---|---|---|
| Module | `<Name>Module` | `WorkspaceModule` |
| Service | `<Name>Service` | `MemoryService` |
| 错误类 | `<Name>Error extends Error`，带 `code` 字段 | `WorkspaceError`（见 `workspace/workspace.service.ts:14`） |
| 类型文件 | `xxx.types.ts` | `history.types.ts` |
| 配置文件 | `xxx.config.ts` | `memory.config.ts` |
| Vue 内容块组件 | `<Xxx>Block.vue` | `MarkdownBlock.vue` / `SpecGateBlock.vue` |

---

## 3. 契约层：`packages/common`（强制）

- **前后端所有共享类型必须放在 `packages/common/src/`**；不要在 `apps/agent` 或 `apps/ui` 里各写一份"看起来一样"的 `interface`
- **`ContentBlock`（`packages/common/src/content-block.ts`）是前后端唯一 SSE 协议**：
  - 新增块类型：**先改 `common`，再改后端发送端，最后改前端渲染端**；三者必须在同一个 PR 中
  - 修改已存在的字段：视为**破坏性变更**，PR 描述里必须显式标注 `[breaking]`，并在 `README.md` 的"SSE Content Block 协议"段同步
  - 每个块必须带 `type` 字段作为判别式
- 未来引入运行时校验（zod）后，收发两端都必须过 schema，禁止 `as unknown as ContentBlock` 硬转

---

## 4. 自研 Agent 服务（`apps/agent`）强制约定

### 4.1 错误处理

- **抛错必须使用带 `code` 的自定义错误类**（模式：`WorkspaceError`）
  - ✅ `throw new WorkspaceError('READ_DENIED', '...')`
  - ❌ `throw new Error('read denied')`
- 每个子系统若需要错误分类，新增自己的 `<name>.error.ts`，不共用一个 God-Error
- 顶层不吞异常；在 Controller / Agent 边界统一转成 `text` 或 `json` ContentBlock 下发前端

### 4.2 配置读取

- **只通过 NestJS `ConfigService` 读环境变量**；禁止在业务代码里出现 `process.env.XXX`
- 各子系统对应的默认值 + 校验放到 `<name>.config.ts`
- 新增环境变量必须同步：
  1. `.env.example`（含注释与默认值）
  2. `README.md` 的"关键变量速查"表
  3. `<name>.config.ts` 的解析逻辑

**已登记的豁免点**（新增豁免必须通过 §13 例外流程）：

| 位置 | 变量 | 豁免理由 |
|---|---|---|
| `apps/agent/src/main.ts` | `PORT` | Nest 启动脚手架，`app.listen()` 之前 ConfigService 生命周期尚未介入 |
| `apps/agent/src/app/agent/workspace/workspace.service.ts` `spawn env` | `PATH` / `HOME` / `LANG` | 白名单式**主进程 shell 环境**直传给子进程，属于运行时环境而非"配置项" |
| `apps/agent/webpack.config.js` | `NODE_ENV` | 构建脚本，非运行时业务代码 |
| `apps/chroma/**` | 全部 | 独立 CLI 应用，无 Nest 容器上下文 |

### 4.3 文件系统访问

- **对 `workspace/` 及以下路径的读写只能通过 `WorkspaceService`**，禁止业务代码直接 `import 'node:fs'` 写这个目录
- 内置禁区（`.git` / `node_modules` / `.env*` / `*.pem` / `*.key`）已在 `WorkspaceService` 中生效，任何"绕过"都不许可
- 命令执行只能通过 `run_command` 工具，遵守白名单 + 超时 + 输出截断；新增白名单命令要在 PR 描述里说明必要性
- SDD 产物路径（`<SDD_ROOT>/...`）是**唯一允许绕过 workspace 只读**的写入通道，且只能通过 `SddService`

### 4.4 LangChain 工具

- 新增工具时：
  1. 文件放 `tools/<domain>/<name>.tool.ts` 或 `tools/<name>.tool.ts`
  2. 通过 `tools/index.ts` 里的 `ToolSpec` 数组集中注册（不要在别处 `bindTools`）
  3. 通过 `enabled()` 决定是否装配（依赖某能力就检查其配置）
  4. 工具入参用 `zod` schema 校验；描述面向 LLM 写清楚 **何时用、返回什么**
- 需要人类批准的动作（如 SDD 阶段跃迁）必须走**闸门**（`SddService.approve`），不得在工具内部绕过

### 4.5 LLM 使用

- 只通过 `LlmService.get(tier)` 获取模型，tier ∈ `fast | pro`
- Flush / 快速摘要类固定走 `fast`；深度推理走 `pro`；不要在业务代码里 `new ChatOpenAI(...)`
- 每次调用后应向流中发送一个 `usage` ContentBlock（tokens / model / llmCalls）

### 4.6 数据持久化

- 会话历史：只通过 `HistoryService`；直接操作 `apps/agent/.data/history.db` 属于违规
- 每轮结束回写 user / assistant / tool 三类消息，回放送 LLM 时只送 user / assistant，且过滑窗
- 长期记忆：只通过 `MemoryService`；`apps/agent/.memory/MEMORY.md` 与日志目录**不得被业务代码手动改写**（用户手改除外）

---

## 5. 前端强制约定（`apps/ui` / `apps/ui-astro`）

- Vue 3.5 **组合式 API + `<script setup lang="ts">`**；不写 Options API
- **SSE 消费只有一份实现**（`ChatView.vue` 中）；新增视图请复用同一份流控逻辑，不要各写一遍
- ContentBlock 渲染走**判别联合**：`switch (block.type)` 到对应 `XxxBlock.vue` 组件；新增块类型必须同步新增对应组件
- 带 `source: 'tool'` 的块默认折叠（`<details>`），不允许自动展开
- 状态管理默认 `ref` / `reactive` + composable；不引入 Pinia / Vuex，除非在 ADR 中论证过必要性
- 样式：优先 scoped CSS；不引入新的 UI 框架（当前无 Element / Naive / Ant，不要加）

---

## 6. AI 编码助手协作约定（外部 AI 工具请重点读）

> 本章面向 **CodeBuddy / Claude Code / Codex / Cursor 等外部 AI 编码助手**，与自研 Agent（`apps/agent`）无关。

### 6.1 修改前必做

1. 读 `README.md` 的"目录结构"和"七大子系统"段，定位改动所在的应用/子系统
2. 用 `codebase_search` / `grep_search` 找到既有实现，**优先复用而非新建**
3. 若属于跨模块改动（改 2 个及以上模块）→ **走 SDD 四阶段流程**（`specify → plan → tasks → implement`），别一把梭

### 6.2 Skill 优先

- 若宿主 AI 编码助手支持 Skill 机制（沉淀"如何做 X"型任务清单），接到相似任务时先加载对应 Skill
- 若发现某类任务重复出现且没有 Skill → 顺手补一份，避免下次重新发明

### 6.3 Memory 卫生

- 若宿主 AI 编码助手支持记忆机制：常青记忆只沉淀**长期不变的事实**（技术选型、命名规范、模型分档）
- 每日/会话日志只沉淀**决策摘要**，禁止落业务数据（PII、密钥、大段代码）
- 不要在任务里主动改写记忆文件，由宿主 Flush 机制自然产出

### 6.4 上下文卫生

- 大文件（>1K 行）**用 `codebase_search` / `grep_search` 定位后再局部读**，不要 `read_file` 整读
- 对同一文件的连续多点编辑 → 一次 `multi_replace` 完成，不要多次 `replace_in_file`

### 6.5 输出卫生

- **禁止**留下无价值 TODO（如 `// TODO: implement this later`）；要么现在实现，要么开 issue 并在注释里引用 issue 号
- **禁止**留空 `catch {}`；至少要 log 或 rethrow
- **禁止**在生产代码里留 `console.log` 调试；用 Nest `Logger`
- **禁止**将示例 key / token / URL 写死到代码里，全部通过环境变量

---

## 7. 测试与验证（强制）

- 修改 `X.ts` → 同步维护 `X.spec.ts`；纯类型文件、纯配置文件、`*.module.ts` 可豁免
- 测试运行器：`vitest`（通过 `vitest.workspace.ts`）
- 测试真实性：
  - Service 层允许 mock 外部 IO（LLM / 文件 / SQLite）
  - **但不允许**mock 掉被测函数自身的内部分支
  - 契约类（`packages/common`）必须有等价类测试（Equivalence class），不能只测 happy path
- CI（`.github/workflows/ci.yml`）会跑 `nx affected -t lint / typecheck / test / build`，任何一项红 → 拒绝合入
- 提交前本地至少跑一次：

  ```sh
  pnpm exec nx affected -t lint typecheck test --parallel=3
  ```

---

## 8. 文档同步（强制）

以下改动**必须**在同一 PR 中同步文档：

| 改动 | 需同步 |
|---|---|
| 新增 / 修改环境变量 | `.env.example` + `README.md` 变量表 |
| 新增 / 修改 ContentBlock 类型 | `README.md` SSE 协议段落 |
| 新增子系统 / 新增 API 端点 | `README.md` 目录结构 + API 表格 |
| 新增子系统 / 修改运行时依赖 | `README.md` 技术栈段 |
| 架构级决策（选型 / 分层 / 协议）| 新增 `docs/adr/NNNN-title.md` |

未同步文档的 PR，review 时会被要求补齐。

---

## 9. 依赖治理（强制）

- 新增依赖必须在 PR 描述里说明：**为什么必要 / 是否有既有替代 / 包大小 / 维护活跃度**
- 优先使用已在仓库中的库（HTTP：仓库已有 `axios`；日期：Node 原生；SQLite：Node 内置）
- **禁止**引入功能重叠的库（例：已有 `axios` 就不要再加 `node-fetch` / `got`）
- 定期（Debt Day）跑 `pnpm exec knip`、`pnpm exec madge --circular apps packages` 清理

---

## 10. 提交与 PR

- Commit message：**Conventional Commits**（`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` / `build` / `ci`）
- PR 描述遵循 `.github/PULL_REQUEST_TEMPLATE.md`（含 Scope / Intent / AI Ratio / Verify / Doc Impact）
- **AI 生成占比 > 80%** 的 PR：需要 **两名人类 reviewer** 通过
- CODEOWNERS 中的 owner 必须显式批准，方可合入

---

## 11. 快速自检清单（AI 编码助手每次提交前默念）

- [ ] 我改的东西属于哪个子系统？边界内解决了吗？
- [ ] 用了 `WorkspaceError` 等类型化错误？没有裸 `throw new Error(string)`？
- [ ] 环境变量走 `ConfigService`？没有 `process.env.XXX`？
- [ ] 文件写走 `WorkspaceService`？没有裸 `fs.writeFile`？
- [ ] 新增/修改类型放到 `packages/common`？前后端同步了？
- [ ] 新增工具走了 `ToolSpec` 数组注册？
- [ ] 修改的 `.ts` 有对应 `.spec.ts` 更新？
- [ ] `.env.example` / `README.md` / ADR 需要同步吗？同步了吗？
- [ ] 本地跑了 `nx affected -t lint typecheck test`？
- [ ] PR 描述里的 Scope 覆盖了所有实际改动路径？没有越界？

---

## 12. 常见反模式（**禁止**）

| 反模式 | 违反条款 |
|---|---|
| `throw new Error('...')` | §4.1 |
| `process.env.XXX` 出现在非 `*.config.ts` 里 | §4.2 |
| 业务代码 `import 'node:fs'` 写 workspace | §4.3 |
| `bindTools([...])` 分散在多处 | §4.4 |
| `new ChatOpenAI(...)` 出现在 Service 里 | §4.5 |
| 前后端各自维护一份"看起来一样"的接口 | §3 |
| 空 `catch {}` / `// TODO` 无 issue 号 | §6.5 |
| 引入 `node-fetch` / `got` 等重复功能库 | §9 |
| 未跑 lint 的 PR / 未同步 `.env.example` 的变量新增 | §7 / §8 |

---

## 13. 例外流程

任何"我知道这违反条款，但确有必要"的情况：

1. 在 PR 描述里显式引用违反的条款编号
2. 说明原因、影响范围、回滚成本
3. 在 `docs/adr/` 新增一份 ADR 记录此决策
4. 由 CODEOWNERS 中至少一名 owner 显式批准

未走上述流程的例外一律视为违规。

---

**最后一句：宪法不是限制创造，而是让创造可复用、可维护、可持续。**
