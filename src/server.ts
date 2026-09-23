import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OdatanoClient } from './client.js';
import type { OdatanoMcpConfig } from './config.js';
import { registerTools, type Capabilities } from './tools/index.js';

export const SERVER_VERSION = '0.4.0';

/**
 * Probe which optional services the host serves: the v2.0 worker and indexer
 * services and ODATANO ASTRA (analytics). The probes run in parallel and never
 * throw; an unreachable host simply yields no optional tools (the core tools
 * are registered regardless and report errors per call).
 */
export async function detectCapabilities(client: OdatanoClient): Promise<Capabilities> {
  const [worker, indexer, analytics] = await Promise.all([
    client.serviceStatus('worker'),
    client.serviceStatus('indexer'),
    client.analyticsStatus(),
  ]);
  return {
    worker: worker === 'served',
    indexer: indexer === 'served',
    analytics: analytics === 'served',
    closed: worker === 'closed' || indexer === 'closed',
  };
}

/**
 * Build the MCP server with all tools registered; transport is the caller's
 * choice. `caps` defaults to "core only" so callers that cannot reach the host
 * (unit tests, schema inspection) get a deterministic tool set.
 */
export function buildServer(config: OdatanoMcpConfig, caps: Capabilities = { worker: false, indexer: false }): McpServer {
  const server = new McpServer({ name: 'odatano', version: SERVER_VERSION });
  registerTools(server, { client: new OdatanoClient(config), config }, caps);
  return server;
}
