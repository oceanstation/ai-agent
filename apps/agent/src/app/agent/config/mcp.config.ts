import type { ConfigService } from '@nestjs/config';
import type { ClientConfig } from '@langchain/mcp-adapters';

/**
 * MCP（Model Context Protocol）子系统的运行时配置。
 *
 * 密钥类信息（如 `AMAP_MCP_KEY`）不进代码，走环境变量注入。
 * 未配置密钥时，对应的 server 会被跳过，避免拼出 `key=` 空值的坏 URL。
 */
export interface McpConfig {
  /** 是否启用 MCP：servers 为空时置 false，业务层据此跳过 client 构造 */
  enabled: boolean;
  /** 可直接用于 `new MultiServerMCPClient(client)` 的完整入参 */
  client: ClientConfig;
}

export function loadMcpConfig(configService: ConfigService): McpConfig {
  const mcpServers: NonNullable<ClientConfig['mcpServers']> = {};

  const amapKey = configService.get<string>('AMAP_MCP_KEY');
  if (amapKey) {
    mcpServers['amap-maps'] = {
      transport: 'http',
      url: `https://mcp.amap.com/mcp?key=${amapKey}`,
    };
  }

  mcpServers['chrome-devtools'] = {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
  };

  return {
    enabled: Object.keys(mcpServers).length > 0,
    client: { mcpServers },
  };
}
