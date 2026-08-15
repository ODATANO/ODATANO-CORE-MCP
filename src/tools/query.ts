import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServiceKey } from '../config.js';
import { makeRunner, type ToolContext } from './shared.js';

/** Read-only entities an agent may query, mapped to the service that serves them. */
export const ENTITY_SERVICE: Record<string, ServiceKey> = {
  // CardanoODataService — the indexer cache (populated by Get* reads and by the v2.0 crawler)
  NetworkInformation: 'odata',
  Blocks: 'odata',
  Epochs: 'odata',
  Pools: 'odata',
  Dreps: 'odata',
  Assets: 'odata',
  AssetHistory: 'odata',
  Transactions: 'odata',
  TransactionInputs: 'odata',
  TransactionOutputs: 'odata',
  TransactionInputAssets: 'odata',
  TransactionOutputAssets: 'odata',
  TransactionMetadata: 'odata',
  Accounts: 'odata',
  Addresses: 'odata',
  AddressAssets: 'odata',
  AddressUTxOs: 'odata',
  AddressTransactions: 'odata',
  UTxOAssets: 'odata',
  LedgerProtocolParameters: 'odata',
  // CardanoTransactionService — build / submission audit trail
  TransactionBuilds: 'transaction',
  TransactionBuildInputs: 'transaction',
  TransactionBuildOutputs: 'transaction',
  TransactionBuildInputAssets: 'transaction',
  TransactionBuildOutputAssets: 'transaction',
  TransactionSubmissions: 'transaction',
  TransactionSubmissionErrors: 'transaction',
  AddressTransactionBuilds: 'transaction',
  // CardanoSignService — signing workflow audit trail
  SigningRequests: 'sign',
  SignatureVerifications: 'sign',
  AddressSigningRequests: 'sign',
};

/** v2.0 entities, only offered when the capability probe found the service. */
export const V2_ENTITY_SERVICE: Record<string, ServiceKey> = {
  WalletJobs: 'worker',
  WorkerWallets: 'worker',
  SyncState: 'indexer',
  ReorgLog: 'indexer',
};

export interface QueryCapabilities {
  worker: boolean;
  indexer: boolean;
}

export function registerQueryTools(server: McpServer, ctx: ToolContext, caps: QueryCapabilities): void {
  const { client, config } = ctx;
  const run = makeRunner(ctx);

  const entityMap: Record<string, ServiceKey> = { ...ENTITY_SERVICE };
  for (const [name, service] of Object.entries(V2_ENTITY_SERVICE)) {
    if ((service === 'worker' && caps.worker) || (service === 'indexer' && caps.indexer)) {
      entityMap[name] = service;
    }
  }
  const entityNames = Object.keys(entityMap) as [string, ...string[]];

  server.registerTool(
    'query_entity',
    {
      description:
        'Generic OData V4 query over the ODATANO entity sets (the indexer cache: everything previously ' +
        'fetched by the get_* tools, plus - on hosts with the v2.0 crawler - contiguously pre-synced blocks ' +
        'and transactions). Standard OData syntax: $filter (e.g. "fee gt 500000 and blockHeight ge 1000000"), ' +
        '$select, $expand (e.g. "inputs,outputs" on Transactions), $orderby, $top/$skip, $count. Numeric ' +
        'Int64/Decimal fields are returned as strings (CAP 10). Read-only; write verbs are rejected upstream ' +
        `with 405. Results are capped at ${config.maxRows} rows unless top is set lower; use skip to page. ` +
        `Entities: ${entityNames.join(', ')}.`,
      inputSchema: {
        entity: z.enum(entityNames).describe('Entity set name'),
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
      const service = entityMap[args.entity];
      const payload = (await client.queryEntity(service, args.entity, {
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
        service,
        returned: rows.length,
        ...(payload?.count !== undefined ? { count: payload.count } : {}),
        rows,
      };
    }),
  );
}
