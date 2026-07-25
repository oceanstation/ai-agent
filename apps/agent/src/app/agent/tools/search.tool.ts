import { tool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

/**
 * search 工具的入参 schema
 */
const searchSchema = z.object({
  query: z.string().describe('搜索查询语句'),
  maxResults: z.number().optional().describe('最大返回条数，默认 5'),
  topic: z
    .enum(['general', 'news', 'finance'])
    .optional()
    .describe('搜索主题类型，默认 general'),
  includeRawContent: z
    .boolean()
    .optional()
    .describe('是否包含原始网页内容，默认 false'),
});

/**
 * 创建一个基于 Tavily 的互联网搜索工具，供 Agent 使用。
 *
 * 使用工厂函数是因为 Tavily 需要在运行时注入 API Key，
 * 不适合以模块顶层常量的形式导出。
 *
 * @param tavilyApiKey Tavily 的 API Key（通常从 .env 读取）
 */
export function createSearchTool(tavilyApiKey?: string) {
  const tavily = new TavilySearch({
    maxResults: 5,
    tavilyApiKey,
  });

  return tool(
    async ({
      query,
      maxResults,
      topic,
      includeRawContent,
    }: z.infer<typeof searchSchema>) => {
      const result: unknown = await tavily.invoke({
        query,
        max_results: maxResults ?? 5,
        topic: topic ?? 'general',
        include_raw_content: includeRawContent ?? false,
      });
      return result;
    },
    {
      name: 'internet_search',
      description: '通过 Tavily 在互联网上进行搜索，返回结果列表；用于获取实时或未知的信息。',
      schema: searchSchema,
    },
  );
}
