import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  assetUnit, bech32Address, clampedInt, drepId, hex56, hex64, hexString, poolId, stakeAddress,
} from '../schemas.js';
import { makeRunner, type ToolContext } from './shared.js';

/**
 * Read tools over CardanoODataService. All upstream operations are OData
 * actions (POST); each fetches from the configured backends on a cache miss
 * and UPSERTs into the ODATANO indexer, so repeated calls are cheap.
 * Lookups return `{ found: false }` on 404 instead of an error.
 */
export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  const { client } = ctx;
  const run = makeRunner(ctx);

  // ── Chain & network ────────────────────────────────────────────────

  server.registerTool(
    'get_network_info',
    {
      description:
        'Network summary of the ODATANO host: configured Cardano network (mainnet / preview / preprod), ' +
        'current tip (block, slot, epoch) and backend health. Call once before submitting anything so ' +
        'you know which network the host talks to.',
      inputSchema: {},
    },
    run(async () => client.callAction('odata', 'GetNetworkInformation')),
  );

  server.registerTool(
    'get_latest_block',
    {
      description: 'The most recent Cardano block seen by the host (hash, height, slot, epoch, time, tx count).',
      inputSchema: {},
    },
    run(async () => client.callAction('odata', 'GetLatestBlock')),
  );

  server.registerTool(
    'get_block',
    {
      description: 'Block details by block hash. Returns found:false (not an error) when the block is unknown.',
      inputSchema: {
        hash: hex64('hash').describe('Block hash (blake2b-256, 64 hex)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetBlockByHash', { hash: args.hash }), {
      notFoundAs: (args) => ({ hash: args.hash }),
    }),
  );

  server.registerTool(
    'get_epoch',
    {
      description:
        'Epoch details (start/end time, block and tx counts, output, fees, active stake). ' +
        'Omit epochNumber for the current epoch.',
      inputSchema: {
        epochNumber: z.number().int().nonnegative().optional().describe('Epoch number; omit for the latest epoch'),
      },
    },
    run(async (args) =>
      args.epochNumber === undefined
        ? client.callAction('odata', 'GetLatestEpoch')
        : client.callAction('odata', 'GetEpochByNumber', { epochNumber: args.epochNumber }),
    { notFoundAs: (args) => ({ epochNumber: args.epochNumber }) }),
  );

  server.registerTool(
    'get_protocol_parameters',
    {
      description:
        'Current ledger protocol parameters (min fee coefficients, min UTxO / coinsPerUtxoByte, max tx size, ' +
        'Plutus cost models, collateral percentage, ...). Use when reasoning about fees, min-ADA or script budgets.',
      inputSchema: {},
    },
    run(async () => client.callAction('odata', 'GetLedgerProtocolParameters')),
  );

  server.registerTool(
    'get_transaction',
    {
      description:
        'Transaction by hash: block, slot, fee, size, deposit, validity, asset movements. ' +
        'Set includeInputsOutputs to also return the resolved inputs and outputs (addresses, lovelace, assets, datums). ' +
        'Returns found:false when the transaction is unknown to all backends.',
      inputSchema: {
        hash: hex64('hash').describe('Transaction hash (64 hex)'),
        includeInputsOutputs: z.boolean().optional()
          .describe('Also return inputs and outputs (one extra request); default false'),
      },
    },
    run(async (args) => {
      if (!args.includeInputsOutputs) {
        return client.callAction('odata', 'GetTransactionByHash', { hash: args.hash });
      }
      // One request: the keyed read indexes on a miss AND honours $expand
      // (ODATANO >= 2.0.0-rc.2 / KNOWN_ISSUES #13).
      const row = (await client.readEntity('odata', 'Transactions', args.hash, 'inputs,outputs')) as
        Record<string, unknown> | undefined;
      const expanded = Array.isArray(row?.inputs) || Array.isArray(row?.outputs);
      if (row && (expanded || (!row.hasInputs && !row.hasOutputs))) return row;
      // Older hosts (<= 2.0.0-rc.1) drop $expand on the keyed branch — fall
      // back to the collection form, which honours it on every version.
      // Both paths verified live: rc.3 answers from the keyed read, rc.1 from
      // this fallback, with identical inputs/outputs.
      const page = (await client.queryEntity('odata', 'Transactions', {
        filter: `hash eq '${args.hash}'`,
        expand: 'inputs,outputs',
        top: 1,
      })) as { value?: unknown[] };
      return page?.value?.[0] ?? row;
    }, { notFoundAs: (args) => ({ hash: args.hash }) }),
  );

  server.registerTool(
    'get_transaction_metadata',
    {
      description:
        'On-chain metadata of a transaction as a list of { label, json } entries (CIP-20 messages, ' +
        'label-1447 financial anchors, CIP-25 NFT metadata, ...). Empty list when the tx carries none.',
      inputSchema: {
        txHash: hex64('txHash').describe('Transaction hash (64 hex)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetMetadataByTxHash', { txHash: args.txHash }), {
      notFoundAs: (args) => ({ txHash: args.txHash }),
    }),
  );

  server.registerTool(
    'parse_transaction_cbor',
    {
      description:
        'Decode hex transaction CBOR (signed or unsigned) into structured fields: inputs, outputs, fee, ' +
        'validity interval, mint, metadata, required signers, witness summary. Pure function - no network, ' +
        'no DB write. Use it to inspect an unsigned build before asking a human to sign, or to check a ' +
        'signed CBOR before submitting. Capped at 128 KiB of hex.',
      inputSchema: {
        cbor: hexString('cbor', 131072).describe('Hex-encoded transaction CBOR'),
      },
    },
    run(async (args) => client.callAction('odata', 'ParseTransactionCbor', { cbor: args.cbor }), { keepCbor: true }),
  );

  // ── Address, UTxO & assets ─────────────────────────────────────────

  server.registerTool(
    'get_address',
    {
      description:
        'Address summary: lovelace balance, native-asset balances, stake address, tx count. ' +
        'Returns found:false when the address has never appeared on-chain.',
      inputSchema: {
        address: bech32Address.describe('Bech32 payment address (addr… / addr_test…)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetAddressByBech32', { address: args.address }), {
      notFoundAs: (args) => ({ address: args.address }),
    }),
  );

  server.registerTool(
    'get_utxos',
    {
      description:
        'Unspent outputs. Pass EITHER address (bech32) OR credential (28-byte payment credential hash, 56 hex) - ' +
        'the credential form aggregates every bech32 address sharing that payment key/script hash (Koios-only, ' +
        'always fresh). Each UTxO: txHash, outputIndex, lovelace, assets, inline datum / datum hash, reference script.',
      inputSchema: {
        address: bech32Address.optional().describe('Bech32 payment address'),
        credential: hex56('credential').optional().describe('Payment credential hash (56 hex)'),
      },
    },
    run(async (args) => {
      if (!!args.address === !!args.credential) {
        throw new Error('pass exactly one of address / credential');
      }
      return args.address
        ? client.callAction('odata', 'GetUTxOsByAddress', { address: args.address })
        : client.callAction('odata', 'GetUTxOsByCredential', { credential: args.credential });
    }, { notFoundAs: (args) => ({ address: args.address, credential: args.credential }) }),
  );

  server.registerTool(
    'get_address_assets',
    {
      description: 'Native assets held by an address: unit (policyId+assetNameHex), quantity, decoded asset name.',
      inputSchema: {
        address: bech32Address.describe('Bech32 payment address'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetAssetsByAddress', { address: args.address }), {
      notFoundAs: (args) => ({ address: args.address }),
    }),
  );

  server.registerTool(
    'get_address_transactions',
    {
      description: 'Most recent transactions touching an address (newest first): txHash, block, slot, time.',
      inputSchema: {
        address: bech32Address.describe('Bech32 payment address'),
        limit: clampedInt('limit', 1, 100, 20).describe('Max transactions (1-100, default 20)'),
      },
    },
    run(async (args) =>
      client.callAction('odata', 'GetLatestTransactionsByAddress', { address: args.address, limit: args.limit }),
    { notFoundAs: (args) => ({ address: args.address }) }),
  );

  server.registerTool(
    'get_asset_info',
    {
      description:
        'Native asset by unit (policyId + assetNameHex): total supply, mint/burn tx count, first mint, ' +
        'CIP-25 (on-chain, label 721) and CIP-26 (off-chain registry) metadata where available.',
      inputSchema: {
        unit: assetUnit.describe('policyId (56 hex) + assetNameHex (0-64 hex)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetAssetInfo', { unit: args.unit }), {
      notFoundAs: (args) => ({ unit: args.unit }),
    }),
  );

  server.registerTool(
    'get_asset_history',
    {
      description:
        'Mint / burn events of a native asset, most recent first: txHash, quantity delta, block time ' +
        '(time may be null when only Blockfrost is available).',
      inputSchema: {
        unit: assetUnit.describe('policyId (56 hex) + assetNameHex (0-64 hex)'),
        limit: clampedInt('limit', 1, 100, 20).describe('Max events (1-100, default 20)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetAssetHistory', { unit: args.unit, limit: args.limit }), {
      notFoundAs: (args) => ({ unit: args.unit }),
    }),
  );

  // ── Staking & governance ───────────────────────────────────────────

  server.registerTool(
    'get_account',
    {
      description:
        'Stake account by stake address: controlled amount, rewards, withdrawals, delegated pool, DRep delegation.',
      inputSchema: {
        stakeAddress: stakeAddress.describe('Bech32 stake address (stake… / stake_test…)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetAccountByStakeAddress', { stakeAddress: args.stakeAddress }), {
      notFoundAs: (args) => ({ stakeAddress: args.stakeAddress }),
    }),
  );

  server.registerTool(
    'get_pool',
    {
      description: 'Stake pool by pool id: ticker, name, pledge, margin, fixed cost, live/active stake, saturation, delegators.',
      inputSchema: {
        poolId: poolId.describe('Bech32 pool id (pool1…)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetPoolById', { poolId: args.poolId }), {
      notFoundAs: (args) => ({ poolId: args.poolId }),
    }),
  );

  server.registerTool(
    'get_drep',
    {
      description: 'Governance DRep by id: voting power, active status, anchor URL/hash, delegator count.',
      inputSchema: {
        drepId: drepId.describe('Bech32 DRep id (drep1… / drep_script1…)'),
      },
    },
    run(async (args) => client.callAction('odata', 'GetDrepById', { drepId: args.drepId }), {
      notFoundAs: (args) => ({ drepId: args.drepId }),
    }),
  );
}
