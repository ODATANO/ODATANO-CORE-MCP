/**
 * Integration check for the MCP server, no network required by default:
 * builds the server, connects an MCP client over an in-memory transport,
 * lists the tools and asserts the API tool set is present with schemas, that
 * no operator tool is registered, and that malformed arguments are rejected
 * before any HTTP call.
 *
 * Live mode (optional): set ODATANO_LIVE=1 plus ODATANO_ACCESS_URL and
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
  'build_plutus_spend', 'set_collateral', 'get_build_details',
  'derive_script_address', 'extract_payment_key_hash',
  // sign / submit
  'create_signing_request', 'get_signing_request', 'verify_signature',
  'verify_data_signature', 'submit_signed_transaction', 'submit_verified_transaction', 'get_submission_status',
];
const ANALYTICS_TOOLS = [
  'analytics_overview', 'analytics_key_figures', 'analytics_daily', 'analytics_top', 'analytics_epochs',
  'analytics_metrics', 'analytics_metric', 'analytics_series', 'analytics_compare', 'analytics_anomalies',
];
// Operator tools and the lists the gateway closes: never part of this server.
const NEVER = [
  'sign_with_hsm', 'pause_worker', 'resume_worker', 'pause_crawler', 'resume_crawler',
  'get_sync_status', 'get_reorg_log', 'get_worker_status', 'get_wallet_job_status', 'submit_wallet_job', 'cancel_wallet_job',
  'list_builds_by_address', 'list_signing_requests',
];

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

// 1. API tool set, no analytics.
const core = await connect(config, {});
const coreNames = await expectTools(core, CORE_TOOLS, [...ANALYTICS_TOOLS, ...NEVER]);
if (coreNames.length !== CORE_TOOLS.length) fail(`unexpected tools: ${coreNames.filter((n) => !CORE_TOOLS.includes(n)).join(', ')}`);
console.log(`OK: API tool set, ${coreNames.length} tools`);

// 2. With analytics.
const full = await connect(config, { analytics: true });
const fullNames = await expectTools(full, [...CORE_TOOLS, ...ANALYTICS_TOOLS], NEVER);
console.log(`OK: with analytics, ${fullNames.length} tools`);

// 3. Query covers chain data only.
const queryTool = (await core.listTools()).tools.find((t) => t.name === 'query_entity');
const entities = queryTool.inputSchema.properties.entity.enum;
for (const closed of ['TransactionBuilds', 'SigningRequests', 'TransactionSubmissions', 'WalletJobs', 'SyncState']) {
  if (entities.includes(closed)) fail(`query_entity offers ${closed}`);
}
console.log(`OK: query_entity offers ${entities.length} chain entity sets`);

// 4. Schema-validation path: bad arguments must be rejected without any HTTP call.
//    (baseUrl points at an unroutable host so an accidental call would surface as a network error text.)
const offline = await connect({ ...config, baseUrl: 'http://127.0.0.1:9', timeoutMs: 500 }, {});
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
  console.log(`live: analytics=${caps.analytics}`);
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
  if (caps.analytics) await call('analytics_overview');
  console.log('OK: live round-trip succeeded (nothing was submitted)');
}

console.log('ALL OK');
process.exit(0);
