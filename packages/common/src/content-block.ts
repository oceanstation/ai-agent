/**
 * Content Block —— 对齐 OpenAI / Anthropic Messages API 风格。
 *
 * 前后端共享的消息内容单元协议：
 *   - 后端每次 SSE 推送一个 ContentBlock
 *   - 前端按 `type` 字段分发到对应渲染组件
 *
 * 新增内容类型时，请在此文件扩展 ContentBlock 联合类型，
 * 前后端同时消费该定义，天然保证契约一致。
 */

/**
 * `source` 用于标记该 block 是"工具返回的原始产物"而非"模型输出的正文"。
 * 前端据此把工具产物默认折叠，用户想看时可以展开；模型正文原样展示。
 */
export type BlockSource = 'tool';

/** 纯文本 / Markdown 内容 */
export interface TextBlock {
  type: 'text';
  text: string;
  source?: BlockSource;
}

/** 列表条目（如搜索结果） */
export interface ListItem {
  title: string;
  url: string;
}

/** 列表内容（如搜索结果列表） */
export interface ListBlock {
  type: 'list';
  items: ListItem[];
  source?: BlockSource;
}

/**
 * 通用结构化 JSON 内容 —— 允许对象或数组根节点。
 * 前端由 vue3-json-viewer 渲染，两者都能友好展开。
 */
export interface JsonBlock {
  type: 'json';
  data: Record<string, unknown> | unknown[];
  source?: BlockSource;
}

/** Agent 调用工具的意图 */
export interface ToolUseBlock {
  type: 'tool_use';
  id?: string;
  name: string;
  input?: Record<string, unknown>;
  kind?: 'tool' | 'subagent';
}

/** 流结束标记 */
export interface DoneBlock {
  type: 'done';
}

/** Token 用量（本轮 agent 交互累计） */
export interface UsageBlock {
  type: 'usage';
  /** 输入 token 累计 */
  inputTokens: number;
  /** 输出 token 累计 */
  outputTokens: number;
  /** 总 token（= input + output） */
  totalTokens: number;
  /** 本轮参与统计的 LLM 调用次数 */
  llmCalls: number;
}

/**
 * 会话元信息（SSE 首帧下发）。
 * 后端在 `/agent/invoke` 的第一帧下发 `{ type: 'session', id }`，
 * 前端据此把 sessionId 持久化到 localStorage，后续请求带上以延续多轮对话。
 */
export interface SessionBlock {
  type: 'session';
  id: string;
}

/** SDD 阶段枚举，与后端 SddPhase 保持一致 */
export type SpecGatePhase = 'specify' | 'plan' | 'tasks' | 'implement';

/** 单个阶段在时间线上的状态标记 */
export type SpecGatePhaseStatus = 'approved' | 'pending' | 'current' | 'idle';

/**
 * 规约驱动开发（SDD）阶段闸门块。
 *
 * 后端在 `sdd_write_artifact` 成功写盘后，会通过 tool_result 附带
 * `{ __sddGate: true, ... }` 结构，`agent.blocks.ts` 中的 `tryAsSpecGate`
 * 将其识别并转成本类型下发到前端。
 *
 * - `pendingApproval` 为 true：前端渲染"批准并进入下一阶段"按钮；
 * - 为 false（仅 implement 阶段）：只做完成态展示，无按钮。
 * - `timeline`：4 阶段全局进度快照，前端据此画时间线。
 */
export interface SpecGateBlock {
  type: 'spec_gate';
  featureId: string;
  phase: SpecGatePhase;
  /** 相对 `.specify` 根目录的产物路径，供前端提示用户去哪里审阅 */
  path: string;
  pendingApproval: boolean;
  timeline: Record<SpecGatePhase, SpecGatePhaseStatus>;
}

/** 所有 ContentBlock 变体的联合类型，前后端共同消费 */
export type ContentBlock =
  | TextBlock
  | ListBlock
  | JsonBlock
  | ToolUseBlock
  | DoneBlock
  | SessionBlock
  | UsageBlock
  | SpecGateBlock;
