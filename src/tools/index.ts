import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAnalyticsTools } from './analytics.js';
import { registerBuildTools } from './build.js';
import { registerQueryTools } from './query.js';
import { registerReadTools } from './read.js';
import type { ToolContext } from './shared.js';
import { registerSignTools } from './sign.js';

export interface Capabilities {
  /** True when the host serves ODATANO ASTRA (analytics) next to the core services. */
  analytics?: boolean;
}

/**
 * Register the tools a gateway key can use: reads, query, unsigned builds,
 * signing handoff and submit. The analytics tools only when ASTRA answers.
 */
export function registerTools(server: McpServer, ctx: ToolContext, caps: Capabilities): void {
  registerReadTools(server, ctx);
  registerQueryTools(server, ctx);
  registerBuildTools(server, ctx);
  registerSignTools(server, ctx);
  if (caps.analytics) registerAnalyticsTools(server, ctx);
}
