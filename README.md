# @odatano/core-mcp

[![npm](https://img.shields.io/npm/v/@odatano/core-mcp)](https://www.npmjs.com/package/@odatano/core-mcp)
[![npm downloads](https://img.shields.io/npm/dt/@odatano/core-mcp?logo=npm&label=downloads&color=blue)](https://www.npmjs.com/package/@odatano/core-mcp)
[![ODATANO](https://img.shields.io/badge/ODATANO-%3E%3D%201.11.0%20(2.0.0--rc.3%2B%20recommended)-0C5ECF)](https://www.npmjs.com/package/@odatano/core)
[![MCP](https://img.shields.io/badge/MCP-server-2ea44f)](https://modelcontextprotocol.io/)
[![Node](https://img.shields.io/badge/node-%3E%3D%2020-brightgreen?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-yellow)](LICENSE)

MCP server that lets AI agents use [ODATANO](https://github.com/ODATANO/ODATANO),
the Cardano OData bridge for SAP CAP: read chain, address, UTxO, asset,
staking and governance data; query the indexer with OData `$filter`; build
**unsigned** transactions (ADA, metadata, multi-asset, mint, Plutus V3 spend);
hand them to a human / wallet for signing; verify signatures; submit signed
CBOR; poll confirmations. Sibling of
[NIGHTGATE-MCP](https://github.com/ODATANO/NIGHTGATE-MCP) (Midnight).

The agent gets a **notary, not a wallet**: nothing in this server can sign.
HSM signing (`SignWithHsm*`) and every Admin operation (crawler / worker
pause & resume) are deliberately not exposed. Wallet-worker jobs (ODATANO
2.0, server-managed wallets) are opt-in.

## Requirements

- Node.js >= 20
- A running ODATANO host (`@odatano/core` >= 1.11.0; the worker / indexer
  tools appear automatically on >= 2.0.0-rc.1). **2.0.0-rc.3 or newer is
  recommended** — earlier versions drop `$expand` / `$select` on keyed reads
  (rc.2) and can answer a keyed read with a row the query excludes (rc.3);
  `get_transaction` works around the former, the latter has no workaround.

## Getting an ODATANO instance

The fastest way is the official Docker image (published from the ODATANO
repo on every release; details in its `docs/guides/DOCKER_DEPLOYMENT.md`):

```bash
docker run -d --name odatano -p 4004:4004 \
  -e NETWORK=preview \
  -e BACKENDS=blockfrost,koios \
  -e BLOCKFROST_API_KEY=preview_xxx \
  ghcr.io/odatano/odatano:latest
```

Alternatively any CAP app using the `@odatano/core` plugin works
(`npm i @odatano/core @cap-js/sqlite`, add `cds.requires.odatano-core`,
`cds watch`), e.g. the ODATANO repo itself.

## Setup

```bash
npm install
npm run build
```

Configuration is environment-driven:

| Variable | Default | Purpose |
|---|---|---|
| `ODATANO_BASE_URL` | `http://localhost:4004` | ODATANO host app |
| `ODATANO_USERNAME` / `ODATANO_PASSWORD` | unset | Basic auth (CAP mocked/dev auth, e.g. `alice`) |
| `ODATANO_TOKEN` | unset | Bearer JWT (XSUAA / `auth: jwt`); an `odat_…` value is reserved for the planned ODATANO agent-grant token (sent as `x-agent-token`) |
| `ODATANO_SERVICE_PREFIX` | `/odata/v4` | Prefix before `cardano-odata`, `cardano-transaction`, `cardano-sign`, `cardano-worker`, `cardano-indexer` |
| `ODATANO_TIMEOUT_MS` | `30000` | Per-request timeout |
| `ODATANO_MCP_MAX_ROWS` | `50` | Default `$top` for `query_entity` and cap on arrays in tool output |
| `ODATANO_MCP_ENABLE_WALLET_JOBS` | `false` | Register `submit_wallet_job` / `cancel_wallet_job` (server-managed wallets sign — see below) |

At startup the server probes `<prefix>/cardano-worker/$metadata` and
`<prefix>/cardano-indexer/$metadata`; the 2.0 tools are registered only when
those services exist, so a 1.x host gets a clean 36-tool catalogue.

## Use with Claude Code

```bash
claude mcp add odatano \
  --env ODATANO_BASE_URL=http://localhost:4004 \
  --env ODATANO_USERNAME=alice \
  -- npx -y @odatano/core-mcp
```

Or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "odatano": {
      "command": "npx",
      "args": ["-y", "@odatano/core-mcp"],
      "env": {
        "ODATANO_BASE_URL": "http://localhost:4004",
        "ODATANO_USERNAME": "alice"
      }
    }
  }
}
```

## Tools

### Read (`CardanoODataService`)

| Tool | What it does |
|---|---|
| `get_network_info` | Host network (mainnet / preview / preprod), tip, backend health — call first |
| `get_latest_block` / `get_block` | Latest block / block by hash |
| `get_epoch` | Epoch by number, or the current one |
| `get_protocol_parameters` | Ledger protocol parameters (fees, min-UTxO, cost models, …) |
| `get_transaction` | Transaction by hash, optionally with resolved inputs/outputs |
| `get_transaction_metadata` | Metadata entries (CIP-20, label-1447, CIP-25, …) |
| `parse_transaction_cbor` | Decode signed/unsigned CBOR — pure, no network |
| `get_address` / `get_utxos` / `get_address_assets` / `get_address_transactions` | Address balance, UTxOs (by address or payment credential), assets, recent txs |
| `get_asset_info` / `get_asset_history` | Native asset supply + CIP-25/26 metadata, mint/burn history |
| `get_account` / `get_pool` / `get_drep` | Stake account, stake pool, governance DRep |
| `query_entity` | Generic OData query (`$filter/$select/$expand/$orderby/$top/$skip/$count`) over the indexer entity sets — the way to use the 2.0 crawler pre-sync |

Lookups return `{ found: false }` as a clean negative instead of an error.

### Build — unsigned (`CardanoTransactionService`)

| Tool | What it does |
|---|---|
| `build_ada_transfer` | ADA transfer, optional assets / inline datum / lock at script address / CIP-33 ref script |
| `build_metadata_transaction` | Transfer carrying transaction metadata (anchoring) |
| `build_multi_asset_transfer` | Native assets + ADA to one recipient |
| `build_mint_transaction` | Mint / burn under a Plutus V3 policy (params, required signers, ref inputs, metadata, `__INPUT_IDX__` placeholders) |
| `build_plutus_spend` | Spend a script UTxO: validator + redeemer, continuing datum, extra outputs, combined mint |
| `set_collateral` | Ensure an ADA-only collateral UTxO exists (self-send build if not) |
| `get_build_details` / `list_builds_by_address` | Re-fetch a build / build audit trail |
| `derive_script_address` / `extract_payment_key_hash` | Pure utilities |

Every build returns `{ id, unsignedTxCbor, fee, … }` — **nothing is signed or submitted**.

### Sign handoff, verify, submit (`CardanoSignService` / `CardanoTransactionService`)

| Tool | What it does |
|---|---|
| `create_signing_request` | Build → signing request with instructions + `cardano-cli` command for the human / wallet |
| `get_signing_request` / `list_signing_requests` | State: `pending → verified → submitted` |
| `verify_signature` | Check a signed CBOR against its request (required signers, fee payer) — no submit |
| `verify_data_signature` | CIP-30 `signData` (COSE_Sign1) verification for wallet login / consent |
| `submit_signed_transaction` | Submit already-signed CBOR (by `buildId`, or raw + `network`); duplicate → `alreadySubmitted: true` |
| `submit_verified_transaction` | Verify + submit for a signing request (`deferSubmit` supported) |
| `get_submission_status` | Submission state, optionally re-checking the chain |

### ODATANO 2.0 (registered when the host serves them)

| Tool | What it does |
|---|---|
| `get_sync_status` / `get_reorg_log` | Crawler / pre-sync status and reorg history (`CardanoIndexerService`) |
| `get_worker_status` / `get_wallet_job_status` | Wallet-worker status and job polling (`CardanoWorkerService`) |
| `submit_wallet_job` / `cancel_wallet_job` | **Opt-in** (`ODATANO_MCP_ENABLE_WALLET_JOBS=1`): queue a job that a server-managed wallet builds, signs, submits and confirms — this moves funds; use with a scoped credential only |

## Errors

Upstream OData errors are returned as tool errors with
`{ httpStatus, code, message }` (`ODATANO_INVALID_INPUT`, `ODATANO_NOT_FOUND`,
`ODATANO_INSUFFICIENT_FUNDS`, `ODATANO_TX_VALIDATION_FAILED`,
`ODATANO_PROVIDER_UNAVAILABLE`, `ODATANO_PROVIDER_RATE_LIMITED`, …) so the
agent can react (401 → credentials, 429 → back off, 400 → fix arguments).
Long arrays are capped at `ODATANO_MCP_MAX_ROWS` and large CBOR blobs nested
in results are elided (the tools whose job is returning CBOR keep it).

## Integration check

```bash
npm run integration
```

Runs an in-memory MCP client against the server: asserts the tool sets per
capability, schemas, and that invalid arguments are rejected before any HTTP
call. Optional live round-trip on preview (reads only; add
`ODATANO_TEST_BUILD=1` for one unsigned build that is parsed, never submitted):

```bash
ODATANO_LIVE=1 ODATANO_BASE_URL=http://localhost:4004 ODATANO_USERNAME=alice \
npm run integration
```

Unit tests: `npm test`.

## License

Apache-2.0
