/**
 * End-to-end repair test on the LOCAL devnet (qorechain-devnet).
 *
 * Drives the app's full repair loop against real chain state, using the
 * app's own pure logic (score / grade / diagnosis from src/lib/health.ts)
 * and the qorechaind CLI for reads and writes — the devnet has no REST
 * server, so the CLI is the devnet path by design (see README).
 *
 *   qp-test1 (no key) -> scan: no-pqc-key, score 20
 *     -> register ML-DSA-87 key (MsgRegisterPQCKeyV2)
 *   -> re-scan: no-window, score 70
 *     -> open EVM window (MsgOpenEVMWindow, hybrid cosign)
 *   -> re-scan: healthy, score 100
 *
 * Every transaction is verified with `query tx` (DeliverTx code 0), never
 * just CheckTx. The script is IDEMPOTENT: re-runs skip steps that are
 * already done and still assert the end state, so the suite can be re-run
 * after a revision; skipped steps recover their original tx hash from the
 * chain (tx search by action + sender) so the receipt stays complete. A
 * receipt with all tx hashes is written to
 * scripts/e2e-receipt-<account>.json (hashes only — no key material, ever).
 *
 * Run with: npm run test:e2e
 * Requires: the local devnet node running on :26657 with the qp-test1 key
 * funded (10 QOR), and the qorechaind binary at
 * ~/workspace/qorechain-bounty/bin/qorechaind.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toEvmAddress } from "@qorechain/evm/window";

import {
  computeScore,
  diagnose,
  formatQor,
  gradeFor,
  type HealthSignals,
} from "../src/lib/health.ts";

// ---------------------------------------------------------------------------
// Devnet configuration (test-only; never mainnet).
// ---------------------------------------------------------------------------
const HOME = process.env.HOME ?? "";
const BIN = `${HOME}/workspace/qorechain-bounty/bin/qorechaind`;
const LIB = `${HOME}/workspace/qorechain-bounty/bin/lib`;
const KEYRING_HOME = `${HOME}/workspace/qorechain-bounty/devnet/node1`;
const NODE = "http://localhost:26657";
const CHAIN_ID = "qorechain-devnet";

// The test account is overridable so a fresh account can run the full
// sequence in one invocation (e.g. QP_E2E_ACCOUNT_NAME=qp-test2
// QP_E2E_ACCOUNT_ADDRESS=qor12zvllx0ly4vz723katfy0ts82rnevel3dlvs07).
// Defaults: qp-test1, the account the spec names for this test.
const ACCOUNT_NAME = process.env.QP_E2E_ACCOUNT_NAME ?? "qp-test1";
const ACCOUNT_ADDRESS =
  process.env.QP_E2E_ACCOUNT_ADDRESS ??
  "qor1zyjeduu65sdvaglwvvm54rthjrxeprvezfl6vk";
const PQC_KEY_NAME =
  process.env.QP_E2E_PQC_KEY_NAME ?? `${ACCOUNT_NAME}-pqc`;

const WINDOW_BLOCKS = 7200;
const WINDOW_MAX_TXS = 20;
const WINDOW_MAX_VALUE = "1000qor";
const REGISTER_FEE = "60000uqor";
const REGISTER_GAS = "600000";
const WINDOW_FEE = "50000uqor";
const WINDOW_GAS = "400000";

// ---------------------------------------------------------------------------
// CLI helpers.
// ---------------------------------------------------------------------------
function run(args: string[], opts: { input?: string } = {}): string {
  const r = spawnSync(BIN, args, {
    encoding: "utf8",
    input: opts.input,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: LIB,
    },
    timeout: 120_000,
  });
  if (r.error) throw new Error(`failed to run qorechaind: ${r.error.message}`);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    throw new Error(`qorechaind ${args.join(" ")} exited ${r.status}:\n${out}`);
  }
  return out;
}

function query(args: string[]): string {
  return run(["query", ...args, "--node", NODE, "--output", "json"]);
}

/** Extract the tx hash from a broadcast result (JSON with txhash). */
function txHashOf(broadcastOutput: string): string {
  const parsed = JSON.parse(broadcastOutput) as { txhash?: string; code?: number; raw_log?: string };
  if (typeof parsed.txhash !== "string" || !/^[0-9A-Fa-f]{64}$/.test(parsed.txhash)) {
    throw new Error(`no txhash in broadcast output: ${broadcastOutput.slice(0, 500)}`);
  }
  if (parsed.code !== 0 && parsed.code !== undefined) {
    throw new Error(
      `broadcast rejected (CheckTx code ${parsed.code}): ${parsed.raw_log ?? ""}`,
    );
  }
  return parsed.txhash.toLowerCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Find a previous transaction of this account by message action, so a
 * re-run that skips a broadcast can still record the real tx hash in the
 * receipt (instead of null). Returns null when nothing matches.
 */
function findPriorTx(action: string): { hash: string; height: string } | null {
  const out = run([
    "query", "txs",
    "--query", `message.action='${action}' AND message.sender='${ACCOUNT_ADDRESS}'`,
    "--node", NODE, "--output", "json",
  ]);
  const parsed = JSON.parse(out) as {
    txs?: Array<{ txhash?: string; height?: string; code?: number }>;
  };
  const good = (parsed.txs ?? []).filter(
    (t) => t.code === 0 && typeof t.txhash === "string",
  );
  if (good.length === 0) return null;
  const latest = good[good.length - 1];
  return { hash: latest.txhash!.toLowerCase(), height: latest.height ?? "?" };
}

/**
 * Poll `query tx` until the tx is indexed, then assert DeliverTx code 0.
 * Returns the height it landed at.
 */
async function awaitDelivery(txHash: string, label: string): Promise<string> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const r = spawnSync(
      BIN,
      ["query", "tx", txHash, "--node", NODE, "--output", "json"],
      {
        encoding: "utf8",
        env: { ...process.env, LD_LIBRARY_PATH: LIB },
        timeout: 30_000,
      },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (r.status === 0) {
      // NOTE: `query tx` prints the response FLAT at the top level
      // ({height, txhash, code, raw_log, ...}) — unlike the REST endpoint,
      // which wraps it in `tx_response`. Read the top level.
      const parsed = JSON.parse(out) as {
        code?: number;
        height?: string;
        raw_log?: string;
      };
      const code = parsed.code;
      const height = parsed.height ?? "?";
      if (code === 0) {
        console.log(`  ${label}: DeliverTx code 0 at height ${height}`);
        return height;
      }
      throw new Error(
        `${label} FAILED on-chain (DeliverTx code ${code}): ${parsed.raw_log ?? ""}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`${label}: tx ${txHash} not indexed after 90s:\n${out.slice(0, 500)}`);
    }
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------
// State reads (CLI) -> the app's own health logic.
// ---------------------------------------------------------------------------
interface DevnetState {
  registered: boolean;
  algorithmId: number | null;
  createdAtHeight: string | null;
  windowFound: boolean;
  windowLive: boolean;
  remainingBlocks: bigint;
  remainingTxs: bigint;
  balanceUqor: bigint;
  score: number;
  grade: string;
  diagnosis: string;
  diagnosisReason: string;
}

function readState(): DevnetState {
  // PQC account: JSON object when registered, plain "No PQC key..." text when not.
  const pqcOut = run([
    "query", "pqc", "account", ACCOUNT_ADDRESS,
    "--node", NODE, "--output", "json",
  ]);
  let registered = false;
  let algorithmId: number | null = null;
  let createdAtHeight: string | null = null;
  const trimmed = pqcOut.trim();
  if (trimmed.startsWith("{")) {
    const p = JSON.parse(trimmed) as {
      algorithm_id?: number;
      created_at_height?: number | string;
    };
    registered = true;
    algorithmId = typeof p.algorithm_id === "number" ? p.algorithm_id : null;
    createdAtHeight =
      p.created_at_height !== undefined ? String(p.created_at_height) : null;
  } else if (!trimmed.includes("No PQC key registered")) {
    throw new Error(`unexpected pqc account output: ${trimmed.slice(0, 300)}`);
  }

  const w = JSON.parse(
    query(["pqc", "evm-window", ACCOUNT_ADDRESS]),
  ) as {
    found: boolean;
    live: boolean;
    remaining_blocks: string;
    remaining_txs: string;
  };

  const bank = JSON.parse(query(["bank", "balances", ACCOUNT_ADDRESS])) as {
    balances: Array<{ denom: string; amount: string }>;
  };
  const uqor = bank.balances.find((b) => b.denom === "uqor");
  const balanceUqor = uqor ? BigInt(uqor.amount) : 0n;

  const signals: HealthSignals = {
    pqcRegistered: registered,
    windowFound: w.found,
    windowLive: w.live,
    remainingTxs: BigInt(w.remaining_txs),
    remainingBlocks: BigInt(w.remaining_blocks),
    balanceUqor,
    pqcReadable: true,
    windowReadable: true,
  };
  const score = computeScore(signals);
  const { diagnosis, reason } = diagnose(signals);
  return {
    registered,
    algorithmId,
    createdAtHeight,
    windowFound: w.found,
    windowLive: w.live,
    remainingBlocks: BigInt(w.remaining_blocks),
    remainingTxs: BigInt(w.remaining_txs),
    balanceUqor,
    score,
    grade: gradeFor(score),
    diagnosis,
    diagnosisReason: reason,
  };
}

function printState(label: string, s: DevnetState): void {
  console.log(`${label}`);
  console.log(`  key:      registered=${s.registered} algo=${s.algorithmId ?? "-"} height=${s.createdAtHeight ?? "-"}`);
  console.log(`  window:   found=${s.windowFound} live=${s.windowLive} remaining=${s.remainingBlocks} blocks / ${s.remainingTxs} txs`);
  console.log(`  balance:  ${formatQor(s.balanceUqor)} QOR`);
  console.log(`  verdict:  score ${s.score}/100 grade ${s.grade} diagnosis ${s.diagnosis} (${s.diagnosisReason})`);
}

// ---------------------------------------------------------------------------
// Repair steps.
// ---------------------------------------------------------------------------
function ensurePqcKeyFile(): { name: string; pubkeyHex: string | null } {
  // If the key is already registered on-chain, no key file is needed at all.
  // Otherwise generate one — with a fresh name if a previous run left an
  // unregistered key file behind (its pubkey is not recoverable from the
  // file, and a new keypair is free).
  let name = PQC_KEY_NAME;
  if (existsSync(join(KEYRING_HOME, "pqc", `${name}.dilithium`))) {
    name = `${PQC_KEY_NAME}-r2`;
    if (existsSync(join(KEYRING_HOME, "pqc", `${name}.dilithium`))) {
      name = `${PQC_KEY_NAME}-${Date.now()}`;
    }
  }
  const out = run([
    "tx", "pqc", "gen-key", name,
    "--home", KEYRING_HOME, "--keyring-backend", "test",
  ]);
  const m = out.match(/public_key_hex:\s*([0-9a-fA-F]+)/);
  if (!m) throw new Error(`gen-key printed no public key hex:\n${out.slice(0, 300)}`);
  const pubkeyHex = m[1].toLowerCase();
  if (pubkeyHex.length !== 5184) {
    throw new Error(`unexpected pubkey length: ${pubkeyHex.length} hex chars (want 5184)`);
  }
  console.log(`  generated PQC keypair "${name}" (pubkey ${pubkeyHex.length} hex chars)`);
  return { name, pubkeyHex };
}

function registerKey(pubkeyHex: string, pqcKeyName: string): string {
  const out = run([
    "tx", "pqc", "register-key-v2", "dilithium5", pubkeyHex, "hybrid",
    "--from", ACCOUNT_NAME,
    "--pqc-key", pqcKeyName,
    "--chain-id", CHAIN_ID,
    "--gas", REGISTER_GAS,
    "--fees", REGISTER_FEE,
    "--home", KEYRING_HOME,
    "--keyring-backend", "test",
    "--node", NODE,
    "--output", "json",
    "-y",
  ]);
  return txHashOf(out);
}

function openWindow(pqcKeyName: string): string {
  const dir = mkdtempSync(join(tmpdir(), "qore-pq-e2e-"));
  try {
    const unsigned = join(dir, "window.json");
    const genOut = run([
      "tx", "pqc", "open-evm-window",
      String(WINDOW_BLOCKS), String(WINDOW_MAX_TXS), WINDOW_MAX_VALUE,
      "--from", ACCOUNT_NAME,
      "--chain-id", CHAIN_ID,
      "--gas", WINDOW_GAS,
      "--fees", WINDOW_FEE,
      "--home", KEYRING_HOME,
      "--keyring-backend", "test",
      "--node", NODE,
      "--generate-only",
    ]);
    writeFileSync(unsigned, genOut);
    const cosignOut = run([
      "tx", "pqc", "cosign", unsigned,
      "--from", ACCOUNT_NAME,
      "--pqc-key", pqcKeyName,
      "--chain-id", CHAIN_ID,
      "--fees", WINDOW_FEE,
      "--gas", WINDOW_GAS,
      "--home", KEYRING_HOME,
      "--keyring-backend", "test",
      "--node", NODE,
      "--output", "json",
    ]);
    return txHashOf(cosignOut);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main flow.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("E2E repair test — local devnet (qorechain-devnet)");
  console.log(`  account: ${ACCOUNT_NAME} = ${ACCOUNT_ADDRESS}`);
  console.log(`  evm:     ${toEvmAddress(ACCOUNT_ADDRESS)}`);
  console.log(`  node:    ${NODE}\n`);

  // Precondition: the node answers. (`qorechaind status` prints
  // {node_info, sync_info} flat at the top level — no `result` wrapper.)
  const status = JSON.parse(run(["status", "--node", NODE])) as {
    sync_info?: { latest_block_height?: string };
  };
  console.log(`  node latest height: ${status.sync_info?.latest_block_height ?? "?"}`);

  const receipt: Record<string, unknown> = {
    accountName: ACCOUNT_NAME,
    account: ACCOUNT_ADDRESS,
    evm: toEvmAddress(ACCOUNT_ADDRESS),
    chainId: CHAIN_ID,
    runAt: new Date().toISOString(),
  };

  // --- Step 1: initial scan. ---
  const initial = readState();
  printState("Scan 1 — initial state:", initial);
  receipt.scan1 = { score: initial.score, grade: initial.grade, diagnosis: initial.diagnosis };
  assert.ok(initial.balanceUqor > 0n, "qp-test1 must be funded for the repair test");

  // --- Step 2: register the key (skip if a previous run already did it). ---
  let pqcKeyName = PQC_KEY_NAME;
  if (!initial.registered) {
    assert.equal(initial.diagnosis, "no-pqc-key", "fresh qp-test1 must diagnose no-pqc-key");
    assert.equal(initial.score, 20, "keyless but funded account scores 20");
    const key = ensurePqcKeyFile();
    pqcKeyName = key.name;
    console.log("\nRepair 1 — register ML-DSA-87 key (MsgRegisterPQCKeyV2):");
    const hash = registerKey(key.pubkeyHex!, pqcKeyName);
    console.log(`  broadcast tx: ${hash}`);
    const height = await awaitDelivery(hash, "register-key");
    receipt.registerKeyTx = hash;
    receipt.registerKeyHeight = height;
    receipt.pqcKeyName = pqcKeyName;
  } else {
    console.log("\nRepair 1 — key already registered (previous run), skipping broadcast.");
    const prior = findPriorTx("/qorechain.pqc.v1.MsgRegisterPQCKeyV2");
    if (prior) {
      console.log(`  prior registration tx (recovered): ${prior.hash} at height ${prior.height}`);
      receipt.registerKeyTx = prior.hash;
      receipt.registerKeyHeight = prior.height;
      receipt.registerKeyRecovered = true;
    } else {
      receipt.registerKeyTx = null;
    }
    // The cosign step still needs the PQC key name; the registered key was
    // created by an earlier run of this script under the standard name.
    pqcKeyName = PQC_KEY_NAME;
    if (!existsSync(join(KEYRING_HOME, "pqc", `${pqcKeyName}.dilithium`))) {
      throw new Error(
        `key is registered but ${pqcKeyName}.dilithium is missing — cannot cosign the window tx`,
      );
    }
  }

  // --- Step 3: re-scan after registration. ---
  const afterKey = readState();
  printState("\nScan 2 — after key registration:", afterKey);
  receipt.scan2 = { score: afterKey.score, grade: afterKey.grade, diagnosis: afterKey.diagnosis };
  assert.equal(afterKey.registered, true, "key must be registered after repair 1");
  assert.equal(afterKey.algorithmId, 1, "registered key must be algorithm 1 (Dilithium5)");
  assert.equal(afterKey.diagnosis, afterKey.windowLive ? "healthy" : "no-window");
  assert.equal(afterKey.score, afterKey.windowLive ? 100 : 70);

  // --- Step 4: open the window (skip if a live one already exists). ---
  if (!afterKey.windowLive) {
    console.log(`\nRepair 2 — open EVM window (${WINDOW_BLOCKS} blocks, ${WINDOW_MAX_TXS} txs, ${WINDOW_MAX_VALUE}):`);
    const hash = openWindow(pqcKeyName);
    console.log(`  broadcast tx: ${hash}`);
    const height = await awaitDelivery(hash, "open-window");
    receipt.openWindowTx = hash;
    receipt.openWindowHeight = height;
  } else {
    console.log("\nRepair 2 — a live window already exists (previous run), skipping broadcast.");
    const prior = findPriorTx("/qorechain.pqc.v1.MsgOpenEVMWindow");
    if (prior) {
      console.log(`  prior window tx (recovered): ${prior.hash} at height ${prior.height}`);
      receipt.openWindowTx = prior.hash;
      receipt.openWindowHeight = prior.height;
      receipt.openWindowRecovered = true;
    } else {
      receipt.openWindowTx = null;
    }
  }

  // --- Step 5: final re-scan. ---
  const final = readState();
  printState("\nScan 3 — final state:", final);
  receipt.scan3 = { score: final.score, grade: final.grade, diagnosis: final.diagnosis };
  assert.equal(final.diagnosis, "healthy", "final state must be healthy");
  assert.equal(final.score, 100, "final score must be 100");
  assert.equal(final.grade, "A", "final grade must be A");
  assert.ok(final.remainingBlocks > 0n, "final window must have blocks left");
  assert.ok(final.remainingTxs > 0n, "final window must have txs left");

  const receiptPath = new URL(`./e2e-receipt-${ACCOUNT_NAME}.json`, import.meta.url)
    .pathname;
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`\nReceipt written to ${receiptPath}`);
  console.log("E2E REPAIR TEST (DEVNET): PASS");
}

main().catch((e: unknown) => {
  console.error("\nE2E REPAIR TEST (DEVNET): FAIL");
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
