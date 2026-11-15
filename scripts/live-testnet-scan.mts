/**
 * Live testnet read test (read-only, no funds, no account).
 *
 * Runs the app's scan logic against the public qorechain-diana testnet and
 * asserts the responses parse into the expected health verdicts. Run with:
 *
 *   npm run test:live
 *
 * Targets (public data, no keys involved):
 *   1. A testnet validator account with a registered Dilithium5 key.
 *   2. An address with no key and no balance on testnet.
 */
import assert from "node:assert/strict";

import { evmWindowStatus } from "@qorechain/evm/window";

import {
  computeScore,
  diagnose,
  formatQor,
  gradeFor,
  parseAddressInput,
  weiToUqor,
  type HealthSignals,
} from "../src/lib/health.ts";
import { NETWORKS } from "../src/lib/networks.ts";

const REST = NETWORKS.testnet.rest;
const EVM_RPC = NETWORKS.testnet.evmRpc;

interface PqcAccountBody {
  found: boolean;
  account: {
    algorithm_id: number;
    algorithm_name: string;
    created_at_height: string;
    key_type: string;
  } | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
}

async function ethGetBalanceWei(evmAddress: string): Promise<bigint> {
  const res = await fetch(EVM_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [evmAddress, "latest"],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${EVM_RPC}`);
  const body = (await res.json()) as { result?: string; error?: unknown };
  if (typeof body.result !== "string" || body.error) {
    throw new Error(`eth_getBalance failed: ${JSON.stringify(body)}`);
  }
  return BigInt(body.result);
}

interface LiveScan {
  qor: string;
  evm: string;
  registered: boolean;
  algorithmName: string | null;
  createdAtHeight: string | null;
  windowFound: boolean;
  windowLive: boolean;
  remainingBlocks: bigint;
  remainingTxs: bigint;
  balanceUqor: bigint;
  score: number;
  grade: string;
  diagnosis: string;
}

async function liveScan(qorAddress: string): Promise<LiveScan> {
  const parsed = parseAddressInput(qorAddress);
  assert.ok(parsed, `test address must parse: ${qorAddress}`);

  const pqc = await getJson<PqcAccountBody>(
    `${REST}/qorechain/pqc/v1/account/${parsed.qor}`,
  );
  const window = await evmWindowStatus({ rest: REST, address: parsed.qor });
  const bank = await getJson<{ balances: Array<{ denom: string; amount: string }> }>(
    `${REST}/cosmos/bank/v1beta1/balances/${parsed.qor}`,
  );
  const uqor = bank.balances.find((b) => b.denom === "uqor");
  const balanceUqor = uqor ? BigInt(uqor.amount) : 0n;

  const signals: HealthSignals = {
    pqcRegistered: pqc.found,
    windowFound: window.found,
    windowLive: window.live,
    remainingTxs: window.remainingTxs,
    remainingBlocks: window.remainingBlocks,
    balanceUqor,
    pqcReadable: true,
    windowReadable: true,
  };
  const score = computeScore(signals);
  const { diagnosis } = diagnose(signals);

  return {
    qor: parsed.qor,
    evm: parsed.evm,
    registered: pqc.found,
    algorithmName: pqc.account?.algorithm_name ?? null,
    createdAtHeight: pqc.account?.created_at_height ?? null,
    windowFound: window.found,
    windowLive: window.live,
    remainingBlocks: window.remainingBlocks,
    remainingTxs: window.remainingTxs,
    balanceUqor,
    score,
    grade: gradeFor(score),
    diagnosis,
  };
}

async function main(): Promise<void> {
  console.log(`Live testnet read test — ${REST}\n`);

  // --- Target 1: testnet validator account (key registered, funded). ---
  const validator = await liveScan("qor1q0f4cz33f8sfmvjglh67vwdhsfdukgyvxh0dxp");
  console.log("Target 1 — validator account");
  console.log(`  qor:      ${validator.qor}`);
  console.log(`  evm:      ${validator.evm}`);
  console.log(`  key:      registered=${validator.registered} algo=${validator.algorithmName} height=${validator.createdAtHeight}`);
  console.log(`  window:   found=${validator.windowFound} live=${validator.windowLive} remaining=${validator.remainingBlocks} blocks / ${validator.remainingTxs} txs`);
  console.log(`  balance:  ${formatQor(validator.balanceUqor)} QOR`);
  console.log(`  verdict:  score ${validator.score}/100 grade ${validator.grade} diagnosis ${validator.diagnosis}`);

  assert.equal(validator.registered, true, "validator account must have a registered key");
  assert.equal(validator.algorithmName, "dilithium5", "validator key must be dilithium5");
  assert.equal(validator.createdAtHeight, "5040860", "registration height is immutable on-chain history");
  assert.ok(validator.balanceUqor > 0n, "validator account must be funded");
  // Score follows the live window state; the key (+50) and funds (+20) are fixed.
  assert.equal(validator.score, 70 + (validator.windowLive ? 30 : 0));
  assert.equal(validator.diagnosis, validator.windowLive ? "healthy" : "no-window");

  // Cross-check: the EVM balance (wei) must equal the bank balance (uqor).
  const evmWei = await ethGetBalanceWei(validator.evm);
  const evmUqor = weiToUqor(evmWei);
  console.log(`  evm bal:  ${evmWei} wei = ${formatQor(evmUqor)} QOR (cross-check vs bank)`);
  assert.equal(evmUqor, validator.balanceUqor, "EVM wei balance must match the bank uqor balance");

  // --- Target 2: address with no key and no balance on testnet. ---
  const empty = await liveScan("qor1v5fjclk5sgtdyfs3m4ptjc66pz27376sxcccx7");
  console.log("\nTarget 2 — unregistered address");
  console.log(`  qor:      ${empty.qor}`);
  console.log(`  key:      registered=${empty.registered}`);
  console.log(`  window:   found=${empty.windowFound} live=${empty.windowLive}`);
  console.log(`  balance:  ${formatQor(empty.balanceUqor)} QOR`);
  console.log(`  verdict:  score ${empty.score}/100 grade ${empty.grade} diagnosis ${empty.diagnosis}`);

  assert.equal(empty.registered, false, "address must have no registered key");
  assert.equal(empty.balanceUqor, 0n, "address must have no balance");
  assert.equal(empty.score, 0, "empty account scores 0");
  assert.equal(empty.grade, "F", "empty account grades F");
  assert.equal(empty.diagnosis, "no-pqc-key", "empty account diagnoses no-pqc-key");

  console.log("\nLIVE TESTNET READ TEST: PASS");
}

main().catch((e: unknown) => {
  console.error("\nLIVE TESTNET READ TEST: FAIL");
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
