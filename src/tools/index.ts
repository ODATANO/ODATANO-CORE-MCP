import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAnalyticsTools } from './analytics.js';
import { registerBuildTools } from './build.js';
import { registerIndexerTools } from './indexer.js';
import { registerQueryTools, type QueryCapabilities } from './query.js';
import { registerReadTools } from './read.js';
import type { ToolContext } from './shared.js';
import { registerSignTools } from './sign.js';
import { registerWorkerTools } from './worker.js';

export type Capabilities = QueryCapabilities & {
  /** True when a probe was refused with 403: the ODATANO ACCESS gateway keeps operator services closed. */
  closed?: boolean;
  /** True when the host serves ODATANO ASTRA (analytics) next to the core services. */
  analytics?: boolean;
};

/**
 * Register the tool catalogue. Reads, generic query, unsigned builds and the
 * signing handoff are always present; the v2.0 worker / indexer tools only
 * when the host serves those services (see OdatanoClient.serviceExists), the
 * analytics tools only when ODATANO ASTRA answers on the same host.
 * HSM signing and every Admin action are deliberately never registered.
 */
export function registerTools(server: McpServer, ctx: ToolContext, caps: Capabilities): void {
  registerReadTools(server, ctx);
  registerQueryTools(server, ctx, caps);
  registerBuildTools(server, ctx);
  registerSignTools(server, ctx);
  if (caps.worker) registerWorkerTools(server, ctx);
  if (caps.indexer) registerIndexerTools(server, ctx);
  if (caps.analytics) registerAnalyticsTools(server, ctx);
}
