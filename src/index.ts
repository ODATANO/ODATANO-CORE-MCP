#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OdatanoClient } from './client.js';
import { loadConfig } from './config.js';
import { buildServer, detectCapabilities } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new OdatanoClient(config);
  // stdio transport: stdout is the protocol channel, diagnostics go to stderr
  if (!config.token && !config.username && /^https:\/\/api(\.[a-z0-9-]+)?\.odatano\.dev$/.test(config.baseUrl)) {
    console.error('odatano-mcp: ODATANO_ACCESS_KEY is not set; api.preprod.odatano.dev answers 401 without a key (sign in, redeem a code or buy a pack at https://api.preprod.odatano.dev)');
  }
  const caps = await detectCapabilities(client);
  const server = buildServer(config, caps);
  const optional = [caps.worker && 'worker', caps.indexer && 'indexer', caps.analytics && 'analytics (ASTRA)'].filter(Boolean).join(', ')
    || (caps.closed ? 'none (operator services are closed on the gateway)' : 'none (core < 2.0 or unreachable)');
  console.error(`odatano-mcp: connecting tools to ${config.baseUrl}${config.servicePrefix} (optional services: ${optional}` +
    `${caps.worker && config.enableWalletJobs ? '; wallet jobs ENABLED' : ''})`);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error('odatano-mcp failed to start:', err);
  process.exit(1);
});
