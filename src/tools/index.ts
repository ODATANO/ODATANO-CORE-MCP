import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBuildTools } from './build.js';
import { registerIndexerTools } from './indexer.js';
import { registerQueryTools, type QueryCapabilities } from './query.js';
import { registerReadTools } from './read.js';
import type { ToolContext } from './shared.js';
import { registerSignTools } from './sign.js';
import { registerWorkerTools } from './worker.js';

export type Capabilities = QueryCapabilities;

/**
 * Register the tool catalogue. Reads, generic query, unsigned builds and the
 * signing handoff are always present; the v2.0 worker / indexer tools only
 * when the host serves those services (see OdatanoClient.serviceExists).
 * HSM signing and every Admin action are deliberately never registered.
 */
export function registerTools(server: McpServer, ctx: ToolContext, caps: Capabilities): void {
  registerReadTools(server, ctx);
  registerQueryTools(server, ctx, caps);
  registerBuildTools(server, ctx);
  registerSignTools(server, ctx);
  if (caps.worker) registerWorkerTools(server, ctx);
  if (caps.indexer) registerIndexerTools(server, ctx);
}
