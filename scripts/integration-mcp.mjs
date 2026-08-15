/**
 * Integration check for the MCP server, no network required by default:
 * builds the server, connects an MCP client over an in-memory transport,
 * lists the tools and asserts the core tool set (and, per capability flags,
 * the v2.0 tool set) is present with schemas, and that malformed arguments
 * are rejected before any HTTP call.
 *
 * Live mode (optional): set ODATANO_LIVE=1 plus ODATANO_BASE_URL and
 * credentials to round-trip reads (and one unsigned build) against a running
 * ODATANO on preview using the well-known fixtures. Nothing is submitted.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OdatanoClient } from '../dist/client.js';
import { loadConfig } from '../dist/config.js';
import { buildServer, detectCapabilities } from '../dist/server.js';

const CORE_TOOLS = [
  // read
  'get_network_info', 'get_latest_block', 'get_block', 'get_epoch', 'get_protocol_parameters',
  'get_transaction', 'get_transaction_metadata', 'parse_transaction_cbor',
  'get_address', 'get_utxos', 'get_address_assets', 'get_address_transactions',
  'get_asset_info', 'get_asset_history', 'get_account', 'get_pool', 'get_drep',
  // query
  'query_entity',
  // build
  'build_ada_transfer', 'build_metadata_transaction', 'build_multi_asset_transfer', 'build_mint_transaction',
  'build_plutus_spend', 'set_collateral', 'get_build_details', 'list_builds_by_address',
  'derive_script_address', 'extract_payment_key_hash',
  // sign / submit
  'create_signing_request', 'get_signing_request', 'list_signing_requests', 'verify_signature',
  'verify_data_signature', 'submit_signed_transaction', 'submit_verified_transaction', 'get_submission_status',
];
const WORKER_TOOLS = ['get_worker_status', 'get_wallet_job_status'];
const WORKER_WRITE_TOOLS = ['submit_wallet_job', 'cancel_wallet_job'];
const INDEXER_TOOLS = ['get_sync_status', 'get_reorg_log'];
const NEVER = ['sign_with_hsm', 'pause_worker', 'resume_worker', 'pause_crawler', 'resume_crawler'];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function connect(config, caps) {
  const server = buildServer(config, caps);
  const client = new Client({ name: 'integration-check', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function expectTools(client, expected, forbidden = []) {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const e of expected) if (!names.includes(e)) fail(`missing tool: ${e} (got: ${names.join(', ')})`);
  for (const f of forbidden) if (names.includes(f)) fail(`tool must not be registered: ${f}`);
  for (const tool of tools) {
    if (!tool.description || tool.description.length < 20) fail(`tool ${tool.name} has no useful description`);
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') fail(`tool ${tool.name} has no input schema`);
  }
  return names;
}

const config = loadConfig();

// 1. Core-only capability set (what a 1.x host gets).
const core = await connect(config, { worker: false, indexer: false });
const coreNames = await expectTools(core, CORE_TOOLS, [...WORKER_TOOLS, ...WORKER_WRITE_TOOLS, ...INDEXER_TOOLS, ...NEVER]);
console.log(`OK: core tool set, ${coreNames.length} tools`);

// 2. Full 2.0 capability set, wallet jobs off.
const full = await connect(config, { worker: true, indexer: true });
const fullNames = await expectTools(full, [...CORE_TOOLS, ...WORKER_TOOLS, ...INDEXER_TOOLS], [...WORKER_WRITE_TOOLS, ...NEVER]);
console.log(`OK: v2.0 tool set, ${fullNames.length} tools (wallet jobs off)`);

// 3. Wallet jobs opt-in.
const withJobs = await connect({ ...config, enableWalletJobs: true }, { worker: true, indexer: true });
await expectTools(withJobs, [...CORE_TOOLS, ...WORKER_TOOLS, ...WORKER_WRITE_TOOLS, ...INDEXER_TOOLS], NEVER);
console.log('OK: wallet-job tools registered only with ODATANO_MCP_ENABLE_WALLET_JOBS');

// 4. Schema-validation path: bad arguments must be rejected without any HTTP call.
//    (baseUrl points at an unroutable host so an accidental call would surface as a network error text.)
const offline = await connect({ ...config, baseUrl: 'http://127.0.0.1:9', timeoutMs: 500 }, { worker: false, indexer: false });
const rejects = [
  ['get_block', { hash: 'not-hex' }],
  ['get_address', { address: 'addr_test1QQETX' }],
  ['get_utxos', { address: 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8', credential: 'a'.repeat(56) }],
  ['build_ada_transfer', { senderAddress: 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8', recipientAddress: 'nope', lovelaceAmount: '1' }],
  ['build_ada_transfer', { senderAddress: 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8', recipientAddress: 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8', lovelaceAmount: -5 }],
  ['build_mint_transaction', { senderAddress: 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8', recipientAddress: 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8', lovelaceAmount: '2000000', mintActionsJson: '{"not":"array"}', mintingPolicyScript: '84a4' }],
  ['submit_signed_transaction', { signedTxCbor: '84a4' }], // neither buildId nor network
  ['query_entity', { entity: 'NotAnEntity' }],
  ['parse_transaction_cbor', { cbor: '84a' }],
];
for (const [name, args] of rejects) {
  const res = await offline.callTool({ name, arguments: args })
    .catch((err) => ({ isError: true, content: [{ type: 'text', text: String(err) }] }));
  if (!res.isError) fail(`${name} accepted invalid arguments: ${JSON.stringify(args)}`);
  const text = res.content?.[0]?.text ?? '';
  if (/ECONNREFUSED|fetch failed|timeout/i.test(text)) fail(`${name} reached the network with invalid arguments: ${text}`);
}
console.log(`OK: ${rejects.length} invalid-argument cases rejected before any HTTP call`);

// 5. Live round-trip (optional).
if (process.env.ODATANO_LIVE === '1') {
  const liveClient = new OdatanoClient(config);
  const caps = await detectCapabilities(liveClient);
  console.log(`live: capabilities worker=${caps.worker} indexer=${caps.indexer}`);
  const live = await connect(config, caps);
  const call = async (name, args = {}) => {
    const res = await live.callTool({ name, arguments: args });
    const text = res.content?.[0]?.text ?? '';
    if (res.isError) fail(`${name} failed: ${text}`);
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail(`${name} returned non-JSON: ${text.slice(0, 200)}`); }
    console.log(`  ${name}: ${text.length} chars`);
    return parsed;
  };
  const F = {
    tx: process.env.ODATANO_TEST_TX ?? '2b8216b428b5292a4b13075cf37b26434f890a4ffcce1f75da1f85d2297efe83',
    address: process.env.ODATANO_TEST_ADDRESS ?? 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8',
    block: process.env.ODATANO_TEST_BLOCK ?? 'cb082e3e77a7d8cf56baaba5cbe8843d63b53fa41074557ed29e0dbfe7daab39',
    pool: process.env.ODATANO_TEST_POOL ?? 'pool1knap9hldvhww0fjqew26sxkfjpj3c8tp8uuj7j3729lzqn9x70r',
  };
  const net = await call('get_network_info');
  if (!net || typeof net !== 'object') fail('get_network_info returned no object');
  await call('get_latest_block');
  const block = await call('get_block', { hash: F.block });
  if (block.found === false) fail(`fixture block not found: ${F.block}`);
  const tx = await call('get_transaction', { hash: F.tx, includeInputsOutputs: true });
  if (tx.found === false) fail(`fixture tx not found: ${F.tx}`);
  await call('get_utxos', { address: F.address });
  await call('get_pool', { poolId: F.pool });
  await call('get_protocol_parameters');
  const q = await call('query_entity', { entity: 'Blocks', top: 1, orderby: 'height desc' });
  if (!Array.isArray(q.rows)) fail('query_entity did not return rows');
  const missing = await call('get_block', { hash: 'f'.repeat(64) });
  if (missing.found !== false) fail('unknown block should yield found:false');
  const kh = await call('extract_payment_key_hash', { address: F.address });
  if (!/^[0-9a-f]{56}$/i.test(kh.paymentKeyHash ?? '')) fail('extract_payment_key_hash returned no 56-hex hash');
  if (process.env.ODATANO_TEST_BUILD === '1') {
    const build = await call('build_ada_transfer', { senderAddress: F.address, recipientAddress: F.address, lovelaceAmount: '2000000' });
    if (!build.unsignedTxCbor) fail('build_ada_transfer returned no unsignedTxCbor');
    const parsed = await call('parse_transaction_cbor', { cbor: build.unsignedTxCbor });
    if (!parsed || typeof parsed !== 'object') fail('parse_transaction_cbor failed on the build');
    console.log(`  build ${build.id ?? build.buildId}: fee ${build.fee} (unsigned, not submitted)`);
  }
  if (caps.indexer) await call('get_sync_status');
  if (caps.worker) await call('get_worker_status');
  console.log('OK: live round-trip succeeded (nothing was submitted)');
}

console.log('ALL OK');
process.exit(0);
