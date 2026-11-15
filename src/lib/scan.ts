/**
 * Live scan: read an account's PQC key, EVM window and balance from the
 * chain and turn them into a health verdict. Reads only — no signing, no
 * funds, no account needed.
 *
 * Every query is independent: one failing query does not hide the others,
 * and the error text is preserved verbatim (never swallowed) so the UI can
 * show exactly what the chain — or the network — said.
 */
import { evmWindowStatus, type EvmWindow } from "@qorechain/evm/window";

import {
  computeScore,
  diagnose,
  gradeFor,
  parseAddressInput,
  type Diagnosis,
  type Grade,
  type HealthSignals,
} from "./health.js";
import type { NetworkConfig } from "./networks.js";

export interface PqcInfo {
  registered: boolean;
  algorithmId: number | null;
  algorithmName: string | null;
  createdAtHeight: string | null;
  keyType: string | null;
}

export interface ScanResult {
  input: string;
  qor: string;
  evm: string;
  network: NetworkConfig;
  pqc: PqcInfo;
  /** Verbatim error when the PQC query failed; null on success. */
  pqcError: string | null;
  window: EvmWindow | null;
  /** Verbatim error when the window query failed; null on success. */
  windowError: string | null;
  /** Balance in uqor, or null when the balance query failed. */
  balanceUqor: bigint | null;
  /** Verbatim error when the balance query failed; null on success. */
  balanceError: string | null;
  score: number;
  grade: Grade;
  diagnosis: Diagnosis;
  diagnosisReason: string;
  /** ISO timestamp of the scan. */
  scannedAt: string;
}

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function asError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new Error(`request to ${url} failed: ${asError(e)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parsePqcAccount(body: unknown): PqcInfo {
  if (!isRecord(body) || typeof body.found !== "boolean") {
    throw new Error(`unexpected PQC account response: ${JSON.stringify(body)?.slice(0, 200)}`);
  }
  if (!body.found || !isRecord(body.account)) {
    return {
      registered: false,
      algorithmId: null,
      algorithmName: null,
      createdAtHeight: null,
      keyType: null,
    };
  }
  const a = body.account;
  return {
    registered: true,
    algorithmId: typeof a.algorithm_id === "number" ? a.algorithm_id : null,
    algorithmName: typeof a.algorithm_name === "string" ? a.algorithm_name : null,
    createdAtHeight:
      typeof a.created_at_height === "string" ? a.created_at_height : null,
    keyType: typeof a.key_type === "string" ? a.key_type : null,
  };
}

function parseBankBalance(body: unknown): bigint {
  if (!isRecord(body) || !Array.isArray(body.balances)) {
    throw new Error(`unexpected bank balances response: ${JSON.stringify(body)?.slice(0, 200)}`);
  }
  for (const entry of body.balances) {
    if (
      isRecord(entry) &&
      entry.denom === "uqor" &&
      typeof entry.amount === "string" &&
      /^\d+$/.test(entry.amount)
    ) {
      return BigInt(entry.amount);
    }
  }
  return 0n;
}

/**
 * Scan one address on one network. Throws only when the input address itself
 * is invalid; chain/query failures are reported inside the result.
 */
export async function scanAddress(
  input: string,
  network: NetworkConfig,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<ScanResult> {
  const parsed = parseAddressInput(input);
  if (!parsed) {
    throw new Error(
      "Invalid address: expected a qor1... address or a 0x... address (40 hex characters).",
    );
  }

  let pqc: PqcInfo = {
    registered: false,
    algorithmId: null,
    algorithmName: null,
    createdAtHeight: null,
    keyType: null,
  };
  let pqcError: string | null = null;
  try {
    const body = await fetchJson(
      `${network.rest}/qorechain/pqc/v1/account/${parsed.qor}`,
      fetchImpl,
    );
    pqc = parsePqcAccount(body);
  } catch (e) {
    pqcError = asError(e);
  }

  let window: EvmWindow | null = null;
  let windowError: string | null = null;
  try {
    window = await evmWindowStatus({
      rest: network.rest,
      address: parsed.qor,
      fetch: fetchImpl,
    });
  } catch (e) {
    windowError = asError(e);
  }

  let balanceUqor: bigint | null = null;
  let balanceError: string | null = null;
  try {
    const body = await fetchJson(
      `${network.rest}/cosmos/bank/v1beta1/balances/${parsed.qor}`,
      fetchImpl,
    );
    balanceUqor = parseBankBalance(body);
  } catch (e) {
    balanceError = asError(e);
  }

  const signals: HealthSignals = {
    pqcRegistered: pqc.registered,
    windowFound: window?.found ?? false,
    windowLive: window?.live ?? false,
    remainingTxs: window?.remainingTxs ?? 0n,
    remainingBlocks: window?.remainingBlocks ?? 0n,
    balanceUqor,
    pqcReadable: pqcError === null,
    windowReadable: windowError === null,
  };
  const score = computeScore(signals);
  const { diagnosis, reason } = diagnose(signals);

  return {
    input,
    qor: parsed.qor,
    evm: parsed.evm,
    network,
    pqc,
    pqcError,
    window,
    windowError,
    balanceUqor,
    balanceError,
    score,
    grade: gradeFor(score),
    diagnosis,
    diagnosisReason: reason,
    scannedAt: new Date().toISOString(),
  };
}

export interface TxVerification {
  /** The tx was found on-chain. */
  found: boolean;
  /** DeliverTx code: 0 means the transaction succeeded. */
  code: number | null;
  height: string | null;
  /** The chain's raw log, verbatim (empty on success). */
  rawLog: string | null;
  /** Verbatim error when the lookup itself failed. */
  error: string | null;
}

/**
 * Verify a repair transaction by hash over REST. A found tx with code 0 is a
 * confirmed success; any other code is a failed delivery and the raw log is
 * shown as-is. A hash the chain does not know returns found: false.
 */
export async function verifyTx(
  rest: string,
  hash: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<TxVerification> {
  const clean = hash.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    return {
      found: false,
      code: null,
      height: null,
      rawLog: null,
      error: "Not a transaction hash: expected 64 hex characters.",
    };
  }
  try {
    const body = await fetchJson(`${rest}/cosmos/tx/v1beta1/txs/${clean}`, fetchImpl);
    if (!isRecord(body) || !isRecord(body.tx_response)) {
      throw new Error(`unexpected tx response: ${JSON.stringify(body)?.slice(0, 200)}`);
    }
    const r = body.tx_response;
    return {
      found: true,
      code: typeof r.code === "number" ? r.code : null,
      height: typeof r.height === "string" ? r.height : null,
      rawLog: typeof r.raw_log === "string" ? r.raw_log : null,
      error: null,
    };
  } catch (e) {
    const msg = asError(e);
    if (msg.includes("HTTP 404")) {
      return {
        found: false,
        code: null,
        height: null,
        rawLog: null,
        error: "Transaction not found on this network (yet — it may still be propagating).",
      };
    }
    return { found: false, code: null, height: null, rawLog: null, error: msg };
  }
}
