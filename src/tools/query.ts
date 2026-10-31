import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRunner, type ToolContext } from './shared.js';

/** Entity sets of the read service a gateway key may query: the indexer cache, filled by the Get* reads and the crawler. */
export const QUERY_ENTITIES = [
  'NetworkInformation',
  'Blocks',
  'Epochs',
  'Pools',
  'Dreps',
  'Assets',
  'AssetHistory',
  'Transactions',
  'TransactionInputs',
  'TransactionOutputs',
  'TransactionInputAssets',
  'TransactionOutputAssets',
  'TransactionMetadata',
  'Accounts',
  'Addresses',
  'AddressAssets',
  'AddressUTxOs',
  'AddressTransactions',
  'UTxOAssets',
  'LedgerProtocolParameters',
] as const;

export function registerQueryTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;
  const run = makeRunner(ctx);

  server.registerTool(
    'query_entity',
    {
      description:
        'Generic OData V4 query over the ODATANO chain entity sets (the indexer cache: everything previously ' +
        'fetched by the get_* tools, plus the blocks and transactions the host pre-synced). Standard OData ' +
        'syntax: $filter (e.g. "fee gt 500000 and blockHeight ge 1000000"), $select, $expand (e.g. "inputs,outputs" on Transactions), $orderby, $top/$skip, $count. Numeric ' +
        'Int64/Decimal fields are returned as strings (CAP 10). Read-only; write verbs are rejected upstream ' +
        `with 405. Results are capped at ${config.maxRows} rows unless top is set lower; use skip to page. ` +
        `Entities: ${QUERY_ENTITIES.join(', ')}.`,
      inputSchema: {
        entity: z.enum(QUERY_ENTITIES).describe('Entity set name'),
        filter: z.string().max(4000).optional().describe('OData $filter expression'),
        select: z.string().max(1000).optional().describe('Comma-separated $select list'),
        expand: z.string().max(500).optional().describe('Comma-separated $expand list (compositions/associations)'),
        orderby: z.string().max(500).optional().describe('$orderby, e.g. "blockHeight desc"'),
        top: z.number().int().min(1).max(config.maxRows).optional()
          .describe(`Max rows (1-${config.maxRows}, default ${config.maxRows})`),
        skip: z.number().int().nonnegative().optional().describe('Rows to skip (paging)'),
        count: z.boolean().optional().describe('Include the total match count as `count`'),
      },
    },
    run(async (args) => {
      const payload = (await client.queryEntity('odata', args.entity, {
        filter: args.filter,
        select: args.select,
        expand: args.expand,
        orderby: args.orderby,
        top: args.top ?? config.maxRows,
        skip: args.skip,
        count: args.count,
      })) as Record<string, unknown>;
      // Collection responses are { value: [...] } (+ count when requested).
      const rows = Array.isArray(payload?.value) ? (payload.value as unknown[]) : [];
      return {
        entity: args.entity,
        returned: rows.length,
        ...(payload?.count !== undefined ? { count: payload.count } : {}),
        rows,
      };
    }),
  );
}
