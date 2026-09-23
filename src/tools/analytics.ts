import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRunner, type ToolContext } from './shared.js';

/*
 * Analytics over the Cardano index, served by ODATANO ASTRA through the same
 * gateway and the same key (`/odata/v4/astra`, 1 unit per read). Every tool
 * pins `chain eq 'cardano'`; the Midnight server (@odatano/nightgate-mcp)
 * carries the same tools for its chain, and `analytics_compare` puts both side
 * by side from either. Registered only when the gateway serves ASTRA.
 *
 * Ready-made first: overview, key figures, daily tables, rankings. The generic
 * metric tools take one id of the catalogue (`analytics_metrics` lists it).
 */

const CHAIN = 'cardano';

export const WINDOWS = ['1h', '24h', '7d', '14d', '30d'] as const;
export const RANKING_WINDOWS = ['24h', '7d', '14d', '30d', 'epoch'] as const;

/** Daily tables: tool argument -> entity set. */
export const DAILY_TOPICS = {
  blocks: 'BlocksDaily',
  transactions: 'TransactionsDaily',
  fees: 'FeesDaily',
  tokens: 'TokensDaily',
} as const;

/** Rankings: tool argument -> entity set; pools and dreps are epoch snapshots, the rest flows over a window. */
export const RANKINGS = {
  tokens: 'TopTokens',
  policies: 'TopPolicies',
  addresses: 'TopAddresses',
  scripts: 'TopScripts',
  blockProducers: 'TopBlockProducers',
  pools: 'TopPools',
  dreps: 'TopDReps',
} as const;

const METRIC_HINT = ' Metric ids come from analytics_metrics (e.g. tx.count, fees.paid, blocks.interval, value.transferred).';

/** `YYYY-MM-DD` of the UTC day `days - 1` days before today, so `days` covers today. */
export function sinceDay(days: number, now = Date.now()): string {
  const DAY = 86_400_000;
  return new Date(Math.floor(now / DAY) * DAY - (days - 1) * DAY).toISOString().slice(0, 10);
}

const rows = (payload: unknown): unknown => {
  const p = payload as Record<string, unknown> | null;
  return p && Array.isArray(p.value) ? p.value : payload;
};

export function registerAnalyticsTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;
  const run = makeRunner(ctx);
  const chainFilter = `chain eq '${CHAIN}'`;

  server.registerTool(
    'analytics_overview',
    {
      description:
        'Cardano at a glance from ODATANO ASTRA: network, indexed tip and both lags (index behind chain, ' +
        'analytics behind index), blocks and transactions of the last hour with change vs the hour before, ' +
        'fees of the last 24 h (total, median, p95), average block time and transactions per block. ' +
        'While backfilling is true the recent windows are incomplete - read lastBlockAt.',
      inputSchema: {},
    },
    run(async () => rows(await client.analyticsQuery('ChainOverview', { filter: chainFilter }))),
  );

  server.registerTool(
    'analytics_key_figures',
    {
      description:
        'Every chain-wide Cardano metric over one rolling window (1h, 24h, 7d, 14d, 30d): value, the previous ' +
        'window and the change in percent, plus count/sum/avg/min/max/p50/p95 and the block range. ' +
        'Counters report the sum (blocks, transactions, UTxOs), distributions the average (block interval, ' +
        'fee per transaction, block size). Narrow to one metric with `metric`.' + METRIC_HINT,
      inputSchema: {
        window: z.enum(WINDOWS).optional().describe('Rolling window (default 24h)'),
        metric: z.string().min(1).max(60).optional().describe('One metric id only, e.g. tx.count'),
      },
    },
    run(async (args) => {
      const parts = [chainFilter, `window eq '${args.window ?? '24h'}'`];
      if (args.metric) parts.push(`metric eq '${args.metric.replace(/'/g, "''")}'`);
      return rows(await client.analyticsQuery('KeyFigures', { filter: parts.join(' and '), orderby: 'metric' }));
    }),
  );

  server.registerTool(
    'analytics_daily',
    {
      description:
        'One row per UTC day for Cardano, newest first. topic blocks: blocks, empty blocks, avg/p95/max block ' +
        'time, avg/max block size, tx per block. transactions: count, with assets, with metadata, UTxOs ' +
        'created/spent, ADA volume. fees: total, fee-paying tx, avg/median/p95/max fee in lovelace. tokens: ' +
        'native-asset transfers, mints, burns. Each row carries fromHeight/toHeight for verification.',
      inputSchema: {
        topic: z.enum(Object.keys(DAILY_TOPICS) as [keyof typeof DAILY_TOPICS, ...Array<keyof typeof DAILY_TOPICS>])
          .describe('Which daily table'),
        days: z.number().int().min(1).max(366).optional().describe(`How many days back including today (default 14, max rows ${config.maxRows})`),
      },
    },
    run(async (args) => {
      const days = Math.min(args.days ?? 14, config.maxRows);
      return rows(await client.analyticsQuery(DAILY_TOPICS[args.topic], {
        filter: `${chainFilter} and day ge ${sinceDay(days)}`,
        orderby: 'day desc',
        top: days,
      }));
    }),
  );

  server.registerTool(
    'analytics_top',
    {
      description:
        'Cardano rankings, exact over the whole window (not a stored top-N). tokens / policies by number of ' +
        'transfers (count; sum is the quantity, not comparable across tokens), addresses / scripts by ADA ' +
        'received (sum), blockProducers by blocks produced (count; sum is bytes), pools by live stake and ' +
        'dreps by voting power in the newest epoch snapshot (window epoch). `entities` says how many ' +
        'distinct entities the window holds.',
      inputSchema: {
        ranking: z.enum(Object.keys(RANKINGS) as [keyof typeof RANKINGS, ...Array<keyof typeof RANKINGS>])
          .describe('What to rank'),
        window: z.enum(RANKING_WINDOWS).optional()
          .describe('24h, 7d, 14d, 30d for flows; epoch for pools and dreps (default 24h, or epoch for those two)'),
        limit: z.number().int().min(1).max(200).optional().describe('Rows (default 10)'),
      },
    },
    run(async (args) => {
      const snapshot = args.ranking === 'pools' || args.ranking === 'dreps';
      const window = args.window ?? (snapshot ? 'epoch' : '24h');
      const limit = Math.min(args.limit ?? 10, config.maxRows);
      return rows(await client.analyticsQuery(RANKINGS[args.ranking], {
        filter: `${chainFilter} and window eq '${window}' and rank le ${limit}`,
        orderby: 'rank',
      }));
    }),
  );

  server.registerTool(
    'analytics_epochs',
    {
      description:
        'Cardano stake and governance per epoch, newest first: pools, total live stake (ADA), active DReps, ' +
        'total voting power (ADA), as snapshotted at each epoch boundary.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Epochs (default 10)'),
      },
    },
    run(async (args) => rows(await client.analyticsQuery('StakeEpochs', {
      filter: chainFilter, orderby: 'epoch desc', top: Math.min(args.limit ?? 10, config.maxRows),
    }))),
  );

  server.registerTool(
    'analytics_metrics',
    {
      description:
        'The catalogue of Cardano metrics ASTRA computes: id, name, kind (counter / distribution / gauge), ' +
        'scope (chain-wide, per entity, both), unit and description. Use the ids with analytics_metric, ' +
        'analytics_series, analytics_compare and analytics_key_figures.',
      inputSchema: {},
    },
    run(async () => rows(await client.analyticsQuery('Metrics', {
      filter: chainFilter, select: 'ID,name,kind,scope,unit,description', orderby: 'ID', top: 200,
    }))),
  );

  server.registerTool(
    'analytics_metric',
    {
      description:
        'One Cardano metric over one rolling window with the previous window and the change in percent: ' +
        'value, count, sum, avg, min, max, p50, p95, stddev, block range. Chain-wide metrics only; per-entity ' +
        'metrics (value.received, stake.live, ...) live in analytics_top.' + METRIC_HINT,
      inputSchema: {
        metric: z.string().min(1).max(60).describe('Metric id, e.g. tx.count'),
        window: z.enum(WINDOWS).optional().describe('Rolling window (default 24h)'),
      },
    },
    run(async (args) => client.analyticsFunction('getWindow', { chain: CHAIN, metric: args.metric, window: args.window ?? '24h' })),
  );

  server.registerTool(
    'analytics_series',
    {
      description:
        'Time series of one Cardano metric in the resolution of the window: 1h -> minutes, 24h -> hours, ' +
        '7d/14d/30d -> days. Each point: count, sum, avg, min, max, p50, p95, block range.' + METRIC_HINT,
      inputSchema: {
        metric: z.string().min(1).max(60).describe('Metric id, e.g. fees.paid'),
        window: z.enum(WINDOWS).optional().describe('Rolling window (default 24h)'),
      },
    },
    run(async (args) => client.analyticsFunction('getSeries', { chain: CHAIN, metric: args.metric, window: args.window ?? '24h' })),
  );

  server.registerTool(
    'analytics_compare',
    {
      description:
        'The same metric for Cardano and Midnight side by side over one window (only chains that have the ' +
        'metric answer): tx.count, blocks.count, blocks.interval, fees.paid, ... Fee units differ (lovelace vs DUST).' + METRIC_HINT,
      inputSchema: {
        metric: z.string().min(1).max(60).describe('Metric id both chains know, e.g. tx.count'),
        window: z.enum(WINDOWS).optional().describe('Rolling window (default 24h)'),
      },
    },
    run(async (args) => rows(await client.analyticsFunction('compare', { metric: args.metric, window: args.window ?? '24h' }))),
  );

  server.registerTool(
    'analytics_anomalies',
    {
      description:
        'Cardano days that sit far from their own recent baseline, in standard deviations, over the last ' +
        'COMPLETE day: metric, value, baseline, stddev, z, direction. Every number the verdict rests on comes back.',
      inputSchema: {
        threshold: z.number().min(1).max(20).optional().describe('z-score threshold (default 3)'),
        baselineDays: z.number().int().min(3).max(90).optional().describe('Days the baseline is built from (default 14)'),
      },
    },
    run(async (args) => client.analyticsFunction('getAnomalies', {
      chain: CHAIN, threshold: args.threshold ?? 3, baselineDays: args.baselineDays ?? 14,
    })),
  );
}
