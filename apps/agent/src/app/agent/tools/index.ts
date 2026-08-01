import type { StructuredToolInterface } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import type { MemoryService } from '../memory/memory.service';
import type { SddService } from '../sdd/sdd.service';
import type { SkillService } from '../skills/skill.service';
import type { WorkspaceService } from '../workspace/workspace.service';
import { createListDirTool } from './file/list-dir.tool';
import { createReadFileTool } from './file/read-file.tool';
import { createWriteFileTool } from './file/write-file.tool';
import { createReadMemoryTool } from './read-memory.tool';
import { createReadSkillTool } from './read-skill.tool';
import { createSearchSubagentTool, isSearchSubagentAvailable } from './agents/search.subagent';
import { createRunCommandTool } from './run-command.tool';
import { createReadArtifactTool } from './sdd/read-artifact.tool';
import { createWriteArtifactTool } from './sdd/write-artifact.tool';
import { createWriteMemoryTool } from './write-memory.tool';

export interface BaseToolDeps {
  memoryService: MemoryService;
  skillService: SkillService;
  workspaceService: WorkspaceService;
  sddService: SddService;
}

const logger = new Logger('BaseTools');

/**
 * 单个工具的注册项：statement 式声明，方便集中维护。
 *
 * - enabled：一个短路条件；返回 false 时该工具不会被装配（用于外部 key 缺失等场景）
 * - factory：真正构建 tool 的工厂
 * - fallbackMessage：enabled=false 时的 warn 日志内容
 */
interface ToolSpec {
  name: string;
  enabled: () => boolean;
  factory: () => StructuredToolInterface;
  fallbackMessage?: string;
}

/**
 * 构建 Agent 所需的 base 工具集合。
 *
 * @param deps 工具依赖
 * @param sessionId 当前会话 ID；文件类工具（read/write/list/run_command）会据此
 *   拿到 workspace 的会话作用域视图，实现按 session 的文件隔离。省略则使用共享根。
 */
export function buildBaseTools(
  deps: BaseToolDeps,
  sessionId?: string,
): StructuredToolInterface[] {
  const { memoryService, skillService, workspaceService, sddService } = deps;

  // 文件类工具绑定到“会话作用域”的 workspace 视图；其余工具与 session 无关。
  const ws = workspaceService.forSession(sessionId);

  // specs 只描述"有哪些工具、什么条件下启用、怎么造"，不做任何真正的动作
  const specs: ToolSpec[] = [
    {
      name: 'search',
      enabled: isSearchSubagentAvailable,
      factory: () => createSearchSubagentTool(),
      fallbackMessage:
        '未检测到 TAVILY_API_KEY 或 LLM_FAST_API_KEY，search subagent 将不可用',
    },
    {
      name: 'read_memory',
      enabled: () => true,
      factory: () => createReadMemoryTool(memoryService),
    },
    {
      name: 'write_memory',
      enabled: () => true,
      factory: () => createWriteMemoryTool(memoryService),
    },
    {
      name: 'read_skill',
      enabled: () => true,
      factory: () => createReadSkillTool(skillService),
    },
    {
      name: 'read_file',
      enabled: () => true,
      factory: () => createReadFileTool(ws),
    },
    {
      name: 'write_file',
      enabled: () => true,
      factory: () => createWriteFileTool(ws),
    },
    {
      name: 'list_dir',
      enabled: () => true,
      factory: () => createListDirTool(ws),
    },
    {
      name: 'run_command',
      enabled: () => true,
      factory: () => createRunCommandTool(ws),
    },
    {
      name: 'sdd_write_artifact',
      enabled: () => true,
      factory: () => createWriteArtifactTool(sddService),
    },
    {
      name: 'sdd_read_artifact',
      enabled: () => true,
      factory: () => createReadArtifactTool(sddService),
    },
  ];

  const tools: StructuredToolInterface[] = [];
  for (const spec of specs) {
    if (spec.enabled()) {
      tools.push(spec.factory()); // 只在启用时才调用工厂 → 才真正构造
    } else if (spec.fallbackMessage) {
      logger.warn(spec.fallbackMessage);
    }
  }
  return tools;
}
