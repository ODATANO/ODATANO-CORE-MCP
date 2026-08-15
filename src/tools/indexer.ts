import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRunner, type ToolContext } from './shared.js';

/*
 * ODATANO v2.0 chain crawler / pre-sync (CardanoIndexerService). Status only;
 * pauseCrawler / resumeCrawler are Admin operations and never exposed.
 */
export function registerIndexerTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;
  const run = makeRunner(ctx);

  server.registerTool(
    'get_sync_status',
    {
      description:
        'Chain crawler / pre-sync status on the host (ODATANO >= 2.0): running, syncStatus (idle / syncing / ' +
        'synced / error), last indexed slot + height, chain tip height, syncProgress, consecutive errors. ' +
        'When synced, query_entity over Blocks / Transactions answers from local data with no backend round-trip.',
      inputSchema: {},
    },
    run(async () => client.callFunction('indexer', 'getStatus')),
  );

  server.registerTool(
    'get_reorg_log',
    {
      description:
        'Recent chain reorganisations handled by the crawler (newest first): fork slot/height, blocks rolled ' +
        'back, detected time. Empty when none occurred since the cursor start.',
      inputSchema: {
        limit: z.number().int().min(1).max(config.maxRows).optional().describe(`Max entries (default ${Math.min(20, config.maxRows)})`),
      },
    },
    run(async (args) => {
      const payload = (await client.queryEntity('indexer', 'ReorgLog', {
        orderby: 'detectedAt desc',
        top: args.limit ?? Math.min(20, config.maxRows),
      })) as Record<string, unknown>;
      return Array.isArray(payload?.value) ? payload.value : payload;
    }),
  );
}
