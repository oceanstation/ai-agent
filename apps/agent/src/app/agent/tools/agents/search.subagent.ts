import { tool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';
import { z } from 'zod';
import { createSearchTool } from '../search.tool';

/**
 * search subagent 的入参 schema
 *
 * 只暴露一个 query 字段给主 Agent，避免主 Agent 关心过多细节；
 * subagent 内部自主决定要搜几轮、换什么关键词、如何取舍。
 */
const searchSchema = z.object({
  query: z
    .string()
    .describe('需要调研的主题或问题，尽量完整，例如"2024 年国内主流大模型的上下文窗口对比"'),
  focus: z
    .string()
    .optional()
    .describe('可选：希望重点关注的角度，如"性能"、"价格"、"时效性"'),
});

/**
 * search subagent 的系统提示词
 *
 * 关键约束：
 * 1. **必须调用 internet_search**，不允许仅凭内部知识回答（防止幻觉）；
 * 2. 一次 query 允许多轮搜索 —— 换关键词 / 追问细节 / 交叉验证；
 * 3. 最终产出一段**结构化的中文调研纪要**，主 Agent 拿到就能直接用；
 * 4. 明确要求列出来源，方便主 Agent 复核。
 */
const SEARCH_SYSTEM_PROMPT = `你是一个专业的调研助手（Search Subagent），职责是根据主 Agent 给出的 query，通过 internet_search 工具进行**多轮联网搜索**，然后汇总成一份高质量的调研纪要。

## 工作流程
1. 拆解 query，识别需要检索的核心事实点；
2. 调用 internet_search 进行第一轮搜索；
3. 分析结果，若信息不足或存在冲突，**主动换关键词/换语言/换 topic 再搜一轮**（最多 4 轮）；
4. 综合所有搜索结果，输出最终答案。

## 输出格式（必须遵守）
用 Markdown 输出，包含以下部分：

### 结论
（3~6 句话直接回答 query，客观、准确）

### 关键要点
- 要点 1
- 要点 2
- ...

### 参考来源
- [标题](url)
- ...

## 硬性约束
- **禁止**仅凭你自己的知识回答，必须先调用 internet_search 至少一次；
- **禁止**编造 URL；参考来源必须来自搜索结果；
- 如果搜索结果确实找不到答案，如实说明"未能检索到可靠信息"，不要瞎猜；
- 语气客观、简洁，不要输出寒暄或反问。`;

/**
 * 判断 search subagent 是否具备启用条件。
 *
 * 需同时具备：
 * - TAVILY_API_KEY：subagent 内部搜索工具的凭据
 * - LLM_FAST_API_KEY：subagent 自己的 LLM 凭据（不再从主 Agent 透传）
 *
 * 由 buildBaseTools 的 enabled 短路判断使用，避免装配时抛错。
 */
export function isSearchSubagentAvailable(): boolean {
  return !!process.env.TAVILY_API_KEY && !!process.env.LLM_FAST_API_KEY;
}

function buildSubagentModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: process.env.LLM_FAST_MODEL,
    temperature: 0,
    apiKey: process.env.LLM_FAST_API_KEY,
    configuration: { baseURL: process.env.LLM_FAST_API_URL },
  });
}

export function createSearchSubagentTool() {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    throw new Error('TAVILY_API_KEY 未配置，无法创建 search subagent');
  }

  // 1) 构造 subagent —— 它只持有一个 internet_search 工具
  const subagent = createAgent({
    model: buildSubagentModel(),
    systemPrompt: SEARCH_SYSTEM_PROMPT,
    tools: [createSearchTool(tavilyApiKey)],
  });

  // 2) 把 subagent 包装成 tool，暴露给主 Agent
  return tool(
    async ({ query, focus }: z.infer<typeof searchSchema>) => {
      // 把 focus 拼进 user 消息，让 subagent 感知调研角度
      const userContent = focus
        ? `调研主题：${query}\n关注角度：${focus}`
        : `调研主题：${query}`;

      const result = await subagent.invoke({
        messages: [{ role: 'user', content: userContent }],
      });

      // subagent 的最终答案就在最后一条 AIMessage 里
      const last = result.messages.at(-1);
      const content = last?.content;

      // content 可能是 string 也可能是 MessageContent 数组，做一次归一化
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((c) =>
            typeof c === 'string'
              ? c
              : 'text' in c && typeof c.text === 'string'
                ? c.text
                : '',
          )
          .join('');
      }
      return '';
    },
    {
      name: 'search',
      description:
        '调研一个主题：内部会通过联网搜索工具进行多轮检索、交叉验证，并返回一份带来源的中文调研纪要。适用于需要实时/权威信息、单次搜索不足以覆盖的复杂问题。',
      schema: searchSchema,
    },
  );
}
