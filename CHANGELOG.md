# Changelog

All notable changes to `@odatano/core-mcp` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
