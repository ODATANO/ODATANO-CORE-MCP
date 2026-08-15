import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  amount, bech32Address, hex64, hexString, jsonValue, network, posixMs, uuid,
} from '../schemas.js';
import { JSON_HINT, makeRunner, UNSIGNED_HINT, type ToolContext } from './shared.js';

/*
 * Build tools over CardanoTransactionService. Every Build* action returns a
 * TransactionBuilds row: { id (buildId), unsignedTxCbor, fee, ttl, status,
 * scriptAddress?, scriptHash?, ... }. Nothing is signed here - the host never
 * holds the sender's key in this flow - so exposing the full parameter set is
 * safe: the worst outcome of a bad build is an unsigned CBOR nobody signs.
 */

const validityBounds = {
  validityStartMs: posixMs('validityStartMs').optional()
    .describe('Optional validity-interval start, Posix milliseconds'),
  validityEndMs: posixMs('validityEndMs').optional()
    .describe('Optional validity-interval end, Posix milliseconds'),
};

const scriptParams = {
  scriptParamsJson: jsonValue('scriptParamsJson', 'array').optional()
    .describe('Optional JSON array of PlutusData parameters applied to the script before hashing/building ' +
      '(parameterized validators). Typed entries {"uplc":"data"|"bytes"|"int"|"bool"|"unit","value":…} are ' +
      'applied as native UPLC constants; bare PlutusData entries mean "data".'),
};

const forceInputs = {
  forceInputsJson: jsonValue('forceInputsJson', 'array').optional()
    .describe('Optional JSON array of {txHash, outputIndex} UTxOs that MUST be consumed (one-shot mint seeds, ' +
      'token-carrying UTxOs, deterministic input control)'),
};

const referenceInputs = {
  referenceInputsJson: jsonValue('referenceInputsJson', 'array').optional()
    .describe('Optional JSON array of {txHash, outputIndex} CIP-31 reference inputs (read-only, not consumed): ' +
      'oracle feeds, shared config UTxOs, reference-script UTxOs'),
};

const referenceScript = {
  referenceScriptHex: hexString('referenceScriptHex').optional()
    .describe('Optional Plutus V3 validator CBOR hex attached as CIP-33 reference script on the primary output. ' +
      'Inflates the output min-ADA significantly - lovelaceAmount must cover it.'),
};

const requiredSigners = {
  requiredSignersJson: jsonValue('requiredSignersJson', 'array').optional()
    .describe('Optional JSON array of 28-byte Ed25519 key hashes (56 hex each) that must sign; needed by validators ' +
      'checking extra_signatories. Get a hash via extract_payment_key_hash.'),
};

export function registerBuildTools(server: McpServer, ctx: ToolContext): void {
  const { client } = ctx;
  const run = makeRunner(ctx);

  server.registerTool(
    'build_ada_transfer',
    {
      description:
        'Build a simple ADA transfer (optionally carrying native assets, an inline datum, or locking at a ' +
        'Plutus script address). Coin selection, fee and change are computed by the host (Buildooor).' +
        UNSIGNED_HINT + JSON_HINT,
      inputSchema: {
        senderAddress: bech32Address.describe('Sender / fee payer (bech32)'),
        recipientAddress: bech32Address.describe('Recipient (bech32); ignored when lockOnScript is true'),
        lovelaceAmount: amount('lovelaceAmount').describe('Amount in lovelace (1 ADA = 1000000)'),
        changeAddress: bech32Address.optional().describe('Change address; defaults to senderAddress'),
        outputDatumJson: jsonValue('outputDatumJson').optional()
          .describe('Optional inline datum for the recipient output (PlutusData JSON, DetailedSchema). Required when sending to a script address.'),
        assetsJson: jsonValue('assetsJson', 'array').optional()
          .describe('Optional native assets for the output: [{"unit":"policyId+assetNameHex","quantity":"amount"}]'),
        ...forceInputs,
        validatorScript: hexString('validatorScript').optional()
          .describe('Optional Plutus validator CBOR hex; required when lockOnScript is true (used only to derive the target script address)'),
        ...scriptParams,
        lockOnScript: z.boolean().optional()
          .describe('When true, route the output to the enterprise script address derived from validatorScript (+ scriptParamsJson) instead of recipientAddress'),
        ...referenceScript,
        ...validityBounds,
      },
    },
    run(async (args) => client.callAction('transaction', 'BuildSimpleAdaTransaction', args), { keepCbor: true }),
  );

  server.registerTool(
    'build_metadata_transaction',
    {
      description:
        'Build an ADA transfer that carries transaction metadata (CIP-20 message, label-1447 financial anchor, ' +
        'any label -> JSON). Use lovelaceAmount = min-ADA and recipient = sender for a pure anchoring tx.' +
        UNSIGNED_HINT + JSON_HINT,
      inputSchema: {
        senderAddress: bech32Address.describe('Sender / fee payer (bech32)'),
        recipientAddress: bech32Address.describe('Recipient (bech32); may equal senderAddress'),
        lovelaceAmount: amount('lovelaceAmount').describe('Amount in lovelace'),
        changeAddress: bech32Address.optional().describe('Change address; defaults to senderAddress'),
        metadataJson: jsonValue('metadataJson', 'object')
          .describe('Metadata as JSON object keyed by numeric label string, e.g. {"674":{"msg":["hello"]}}'),
      },
    },
    run(async (args) => client.callAction('transaction', 'BuildTransactionWithMetadata', args), { keepCbor: true }),
  );

  server.registerTool(
    'build_multi_asset_transfer',
    {
      description:
        'Build a transfer of native assets (tokens / NFTs) together with ADA to one recipient.' +
        UNSIGNED_HINT + JSON_HINT,
      inputSchema: {
        senderAddress: bech32Address.describe('Sender / fee payer (bech32)'),
        recipientAddress: bech32Address.describe('Recipient (bech32)'),
        lovelaceAmount: amount('lovelaceAmount').describe('Lovelace to send along (must cover min-ADA of the token output)'),
        assetsJson: jsonValue('assetsJson', 'array')
          .describe('Assets to send: [{"unit":"policyId+assetNameHex","quantity":"amount"}]'),
        changeAddress: bech32Address.optional().describe('Change address; defaults to senderAddress'),
        outputDatumJson: jsonValue('outputDatumJson').optional()
          .describe('Optional inline datum for the recipient output (PlutusData JSON). Required for script addresses.'),
        ...referenceScript,
        ...validityBounds,
      },
    },
    run(async (args) => client.callAction('transaction', 'BuildMultiAssetTransaction', args), { keepCbor: true }),
  );

  server.registerTool(
    'build_mint_transaction',
    {
      description:
        'Build a mint or burn of native assets under a Plutus (V3) minting policy. Supports parameterized policies, ' +
        'required signers, inline datum on the recipient output, CIP-31 reference inputs, CIP-33 reference-script ' +
        'deploy, metadata (CIP-25 label 721 goes in metadataJson) and forced inputs for one-shot policies. ' +
        'Redeemer/datum JSON may contain __INPUT_IDX:<txHash>#<outputIndex>__ placeholders that resolve to the ' +
        'input index after coin selection.' + UNSIGNED_HINT + JSON_HINT,
      inputSchema: {
        senderAddress: bech32Address.describe('Sender / fee payer (bech32)'),
        recipientAddress: bech32Address.describe('Receiver of the minted assets (bech32)'),
        lovelaceAmount: amount('lovelaceAmount').describe('Lovelace sent with the minted assets (must cover min-ADA)'),
        mintActionsJson: jsonValue('mintActionsJson', 'array')
          .describe('Mint/burn actions: [{"assetUnit":"policyId+assetNameHex","quantity":"amount"}] (negative quantity = burn)'),
        mintingPolicyScript: hexString('mintingPolicyScript').describe('Minting policy script CBOR hex (as emitted by Aiken/Plutus; do NOT unwrap)'),
        changeAddress: bech32Address.optional().describe('Change address; defaults to senderAddress'),
        ...requiredSigners,
        ...scriptParams,
        inlineDatumJson: jsonValue('inlineDatumJson').optional()
          .describe('Optional PlutusData JSON inline datum on the recipient output (tokens carrying state)'),
        mintRedeemerJson: jsonValue('mintRedeemerJson').optional()
          .describe('Optional PlutusData JSON redeemer for the policy; defaults to integer 0'),
        lockOnScript: z.boolean().optional()
          .describe('When true (with scriptParamsJson), route the output to the applied script\'s enterprise address instead of recipientAddress'),
        ...forceInputs,
        ...referenceInputs,
        metadataJson: jsonValue('metadataJson', 'object').optional()
          .describe('Optional metadata object keyed by numeric label string (CIP-25: {"721":{...}})'),
        ...referenceScript,
        ...validityBounds,
      },
    },
    run(async (args) => client.callAction('transaction', 'BuildMintTransaction', args), { keepCbor: true }),
  );

  server.registerTool(
    'build_plutus_spend',
    {
      description:
        'Build a transaction spending a UTxO locked at a Plutus (V3) script address: validator + redeemer + the ' +
        'script UTxO (txHash#index), optional datum (hash-based), continuing-output inline datum, extra outputs, ' +
        'combined mint, CIP-31 reference inputs, CIP-33 reference script, required signers. The host evaluates ' +
        'the script locally for the ExUnits budget; on-chain validation at submit stays authoritative.' +
        UNSIGNED_HINT + JSON_HINT,
      inputSchema: {
        senderAddress: bech32Address.describe('Fee payer / collateral provider (bech32)'),
        recipientAddress: bech32Address.describe('Receiver of the unlocked funds (bech32)'),
        lovelaceAmount: amount('lovelaceAmount').describe('Lovelace to send to recipientAddress'),
        validatorScript: hexString('validatorScript').describe('Plutus validator CBOR hex (as emitted by the compiler; do NOT unwrap)'),
        scriptTxHash: hex64('scriptTxHash').describe('Tx hash of the UTxO locked at the script address'),
        scriptOutputIndex: z.number().int().nonnegative().describe('Output index of the locked UTxO'),
        redeemerJson: jsonValue('redeemerJson').describe('Redeemer as PlutusData JSON (constructor/fields, int, bytes, list, map)'),
        datumJson: jsonValue('datumJson').optional().describe('Optional datum PlutusData JSON (only for hash-based datums; inline datums are read from the UTxO)'),
        changeAddress: bech32Address.optional().describe('Change address; defaults to senderAddress'),
        ...requiredSigners,
        ...scriptParams,
        inlineDatumJson: jsonValue('inlineDatumJson').optional()
          .describe('Optional PlutusData JSON inline datum for the recipient output (state-machine continuing output)'),
        lockOnScript: z.boolean().optional()
          .describe('When true (with scriptParamsJson), route the output back to the applied script\'s enterprise address'),
        ...forceInputs,
        extraOutputsJson: jsonValue('extraOutputsJson', 'array').optional()
          .describe('Optional additional outputs after the primary one: [{address, lovelaceAmount, assets?:[{unit,quantity}], inlineDatumJson?, referenceScriptHex?}]'),
        mintActionsJson: jsonValue('mintActionsJson', 'array').optional()
          .describe('Optional mint/burn actions for a combined spend+mint: [{"assetUnit","quantity"}]; requires mintingPolicyScript'),
        mintingPolicyScript: hexString('mintingPolicyScript').optional()
          .describe('Optional minting policy CBOR hex (required with mintActionsJson; if byte-equal to validatorScript, scriptParamsJson applies to it too)'),
        mintRedeemerJson: jsonValue('mintRedeemerJson').optional()
          .describe('Optional PlutusData JSON redeemer for the policy; defaults to integer 0; supports __INPUT_IDX__ placeholders'),
        ...referenceInputs,
        ...referenceScript,
        ...validityBounds,
      },
    },
    run(async (args) => client.callAction('transaction', 'BuildPlutusSpendTransaction', args), { keepCbor: true }),
  );

  server.registerTool(
    'set_collateral',
    {
      description:
        'Ensure a dedicated ADA-only collateral UTxO exists for Plutus transactions: checks the address for ' +
        '>= 2 UTxOs of >= 5 ADA and, if missing, builds a self-send that creates a 5 ADA UTxO. Returns the ' +
        'build (to sign + submit) or a no-op result when collateral is already fine.' + UNSIGNED_HINT,
      inputSchema: {
        address: bech32Address.describe('Address to check / prepare (bech32)'),
      },
    },
    run(async (args) => client.callAction('transaction', 'SetCollateral', { address: args.address }), { keepCbor: true }),
  );

  server.registerTool(
    'get_build_details',
    {
      description:
        'Re-fetch a transaction build by buildId: unsigned CBOR, fee, ttl, status (built / signed / submitted), ' +
        'derived script address, inputs/outputs recorded at build time. Returns found:false for unknown ids.',
      inputSchema: {
        buildId: uuid('buildId').describe('Build id returned by a build_* tool'),
      },
    },
    run(async (args) => client.callAction('transaction', 'GetBuildDetails', { buildId: args.buildId }), {
      keepCbor: true,
      notFoundAs: (args) => ({ buildId: args.buildId }),
    }),
  );

  server.registerTool(
    'list_builds_by_address',
    {
      description: 'Transaction builds recorded for a sender address (build audit trail): buildId, status, fee, created time.',
      inputSchema: {
        address: bech32Address.describe('Sender address (bech32)'),
      },
    },
    run(async (args) => client.callAction('transaction', 'GetTransactionBuildsByAddress', { address: args.address }), {
      notFoundAs: (args) => ({ address: args.address }),
    }),
  );

  server.registerTool(
    'derive_script_address',
    {
      description:
        'Utility: apply optional PlutusData parameters to a validator script and return its enterprise script ' +
        'address (bech32) and 28-byte script hash. Pure derivation - no transaction, no chain call. Script hex ' +
        'from Aiken/Plutus compilers is CBOR-wrapped flat UPLC; pass it as-is (unwrapping changes the hash).' + JSON_HINT,
      inputSchema: {
        validatorScript: hexString('validatorScript').describe('Validator script CBOR hex'),
        ...scriptParams,
        network: network.optional().describe('Network override for the address prefix; defaults to the host network'),
      },
    },
    run(async (args) => client.callAction('transaction', 'DeriveScriptAddress', args)),
  );

  server.registerTool(
    'extract_payment_key_hash',
    {
      description:
        'Utility: decode a bech32 address and return its 28-byte payment credential hash (56 hex). Pure ' +
        'decoding, no chain call. Use it for requiredSignersJson or credential-based UTxO queries.',
      inputSchema: {
        address: bech32Address.describe('Bech32 address (addr… / addr_test…)'),
      },
    },
    run(async (args) => client.callAction('transaction', 'ExtractPaymentKeyHash', { address: args.address })),
  );
}
