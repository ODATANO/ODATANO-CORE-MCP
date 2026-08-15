import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OdatanoClient } from './client.js';
import type { OdatanoMcpConfig } from './config.js';
import { registerTools, type Capabilities } from './tools/index.js';

export const SERVER_VERSION = '0.1.0';

/**
 * Probe which optional (v2.0) services the host serves. Both probes run in
 * parallel and never throw; an unreachable host simply yields no v2.0 tools
 * (the core tools are registered regardless and report errors per call).
 */
export async function detectCapabilities(client: OdatanoClient): Promise<Capabilities> {
  const [worker, indexer] = await Promise.all([
    client.serviceExists('worker'),
    client.serviceExists('indexer'),
  ]);
  return { worker, indexer };
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
