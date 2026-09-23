# Changelog

All notable changes to `@odatano/core-mcp` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-09-23

### Added

- **Analytics tools over ODATANO ASTRA** (`analytics_overview`, `analytics_key_figures`,
  `analytics_daily`, `analytics_top`, `analytics_epochs`, `analytics_metrics`,
  `analytics_metric`, `analytics_series`, `analytics_compare`, `analytics_anomalies`),
  registered when the host serves ASTRA at `ODATANO_ANALYTICS_URL` (default: the gateway's `/odata/v4/astra`). Same key, one unit per read, chain pinned to
  Cardano; `analytics_compare` puts Midnight next to it.

### Changed

- **Default gateway host is `https://api.preprod.odatano.dev`** (one host per
  network; `api.odatano.dev` now only redirects there with a 307). Node drops
  the `Authorization` header on a cross-host redirect, so the old default
  would answer 401 for every call: set `ODATANO_ACCESS_URL` explicitly on
  older versions, or upgrade. The missing-key warning fires for any
  `api.<network>.odatano.dev` host.

## [0.3.0] - 2026-09-20

### Changed (breaking)

- **One connection env for both ODATANO MCP servers.** `ODATANO_ACCESS_URL`
  (default `https://api.odatano.dev`, the gateway), `ODATANO_ACCESS_KEY`
  (the `oda_…` key, or an `odat_…` grant / other bearer against a direct
  instance) and `ODATANO_ACCESS_USER` / `ODATANO_ACCESS_PASSWORD` (basic
  auth for a direct instance) replace `ODATANO_BASE_URL`, `ODATANO_TOKEN`,
  `ODATANO_USERNAME` and `ODATANO_PASSWORD`; the old names are not read
  any more. `@odatano/nightgate-mcp` 0.7.0 reads the same four, so an
  `.mcp.json` needs one key for both chains and no URL.
- **Gateway error bodies reach the agent.** The ODATANO ACCESS gateway
  answers with `{ error: "<text>", ...detail }`; the client now keeps the
  text as the message and hands the detail (`unitsLeft`, `price`, the
  `topup` hint, `products`, `validUntil`, `retryAfterSeconds` from
  `Retry-After`) through to the tool error, so a 402 says how to top up
  instead of "request failed with HTTP 402".
- **The hosted API is the documented default.** README: quick start with a
  key from api.odatano.dev first, own instance second; the startup line
  tells "operator services are closed on the gateway" (403 on the probe,
  `serviceStatus()`) from "core < 2.0 or unreachable", and warns when the
  gateway is the target and no key is set. Server version constant follows
  the package.

## [0.2.1] - 2026-09-19

### Changed

- **The ODATANO ACCESS key (`oda_…`) is the documented credential.** Set
  `ODATANO_BASE_URL=https://api.odatano.dev` and `ODATANO_TOKEN=oda_…`; the
  key goes as a plain `Authorization: Bearer` and the gateway swaps in the
  agent grant, meters the key in units and fronts both ODATANO and
  NIGHTGATE. Get one at `POST https://api.odatano.dev/keys` (x402), from a
  giveaway code, or by signing in at the console. An `odat_…` grant
  (`x-agent-token`) still works against a direct ODATANO instance. No code
  change: the client already sent a prefix-less token as a bearer; a test
  now pins that header shape.

## [0.2.0] - 2026-08-16

### Changed

- **`get_transaction` with `includeInputsOutputs` now costs one request instead
  of two.** ODATANO 2.0.0-rc.2 fixed keyed reads to honour `$expand`
  (KNOWN_ISSUES #13), so the tool reads
  `Transactions('<hash>')?$expand=inputs,outputs` directly — that single call
  indexes the transaction on a cache miss *and* returns the resolved inputs and
  outputs. Hosts up to 2.0.0-rc.1 still drop `$expand` on the keyed branch, so
  the previous collection-query path is kept as an automatic fallback.
  Both paths verified live: rc.3 answers from the keyed read, rc.1 from the
  fallback, with identical results (8 inputs / 3 outputs on the same fixture).
- **Host-version guidance.** README and badge now recommend
  `@odatano/core@2.0.0-rc.3` or newer: rc.1 drops `$expand`/`$select` on keyed
  reads, and everything before rc.3 can answer a keyed read with a row the
  query excludes (a composite key whose second value does not match, or a
  `$filter` that excludes the row, returned a sibling row with 200 instead of
  404). The first has a workaround in this server, the second does not.
  Minimum supported host is unchanged: `@odatano/core >= 1.11.0`.

### Verified

- Against the **published** `@odatano/core@2.0.0-rc.3` running as a CAP plugin
  in a fresh consumer project (Cardano preview): full live round-trip of the
  read, query, build, signing-handoff and v2.0 status tools; unknown keys come
  back as `{ found: false }` rather than a foreign row.
- Against `@odatano/core@2.0.0-rc.1` for the backward-compatibility fallback.

## [0.1.0] - 2026-08-15

Initial release. MCP server exposing ODATANO to AI agents: 36 core tools
(chain / address / asset / staking reads, generic OData `query_entity`,
unsigned transaction builds, signing handoff, verification, submit) plus 4
tools for the ODATANO 2.0 crawler and wallet worker when the host serves them,
and 2 opt-in wallet-job write tools behind `ODATANO_MCP_ENABLE_WALLET_JOBS`.
HSM signing and every Admin operation are deliberately never exposed — the
agent gets a notary, not a wallet.
