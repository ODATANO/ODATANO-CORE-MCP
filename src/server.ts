import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OdatanoClient } from './client.js';
import type { OdatanoMcpConfig } from './config.js';
import { registerTools, type Capabilities } from './tools/index.js';

export const SERVER_VERSION: string = createRequire(import.meta.url)('../package.json').version;

/** Does the host serve ODATANO ASTRA? Never throws; an unreachable host yields no analytics tools. */
export async function detectCapabilities(client: OdatanoClient): Promise<Capabilities> {
  return { analytics: (await client.analyticsStatus()) === 'served' };
}

/**
 * Build the MCP server with all tools registered; transport is the caller's
 * choice. `caps` defaults to no analytics so callers that cannot reach the host
 * (unit tests, schema inspection) get a deterministic tool set.
 */
export function buildServer(config: OdatanoMcpConfig, caps: Capabilities = {}): McpServer {
  const server = new McpServer({ name: 'odatano', version: SERVER_VERSION });
  registerTools(server, { client: new OdatanoClient(config), config }, caps);
  return server;
}
