/**
 * Pure health logic for Qore PQ Health: scoring, grading, diagnosis and
 * address handling. No network access, no side effects — safe to unit-test
 * and to reuse from the Node test scripts.
 *
 * Score rules (from the entry spec, exact):
 *   +50 when an ML-DSA-87 key is registered
 *   +30 when an EVM authorisation window is currently live
 *   +20 when the balance is above zero (can pay fees)
 *
 * Grades: 90–100 A, 70–89 B, 50–69 C, 30–49 D, 1–29 E, 0 F.
 */
import { toEvmAddress, toQorAddress } from "@qorechain/evm/window";

export type Diagnosis = "healthy" | "no-pqc-key" | "no-window" | "exhausted" | "invalid";
export type Grade = "A" | "B" | "C" | "D" | "E" | "F";

/** The raw signals a scan produces, before any judgement is applied. */
export interface HealthSignals {
  /** An ML-DSA-87 key is registered on-chain for this account. */
  pqcRegistered: boolean;
  /** An EVM authorisation window is stored for this account (live or not). */
  windowFound: boolean;
  /** The stored window admits at least one more transaction right now. */
  windowLive: boolean;
  /** Transactions left in the window (0 when there is no window). */
  remainingTxs: bigint;
  /** Blocks left in the window (0 when there is no window). */
  remainingBlocks: bigint;
  /** Balance in uqor, or null when the balance query itself failed. */
  balanceUqor: bigint | null;
  /** False when the PQC query failed or answered something unparsable. */
  pqcReadable: boolean;
  /** False when the window query failed or answered something unparsable. */
  windowReadable: boolean;
}

/** Score 0–100 from the signals, following the spec's exact weights. */
export function computeScore(s: HealthSignals): number {
  let score = 0;
  if (s.pqcRegistered) score += 50;
  if (s.windowLive) score += 30;
  if (s.balanceUqor !== null && s.balanceUqor > 0n) score += 20;
  return score;
}

/** Grade letter for a score, following the spec's exact boundaries. */
export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  if (score >= 1) return "E";
  return "F";
}

export interface DiagnosisResult {
  diagnosis: Diagnosis;
  /**
   * Machine-readable reason, so the UI can explain the edge cases:
   * - "query-failed": a PQC or window read failed — the state is unknowable.
   * - "balance-unknown": key + live window, but the balance read failed.
   * - "unfunded": key + live window, but the balance is exactly zero. The
   *   five-label taxonomy has no label for "quantum-ready but broke", so this
   *   is reported as `invalid` with this reason rather than inventing a
   *   sixth label or mislabelling it as a key/window problem.
   */
  reason:
    | "all-checks-pass"
    | "no-key"
    | "no-window-open"
    | "window-expired-or-used-up"
    | "query-failed"
    | "balance-unknown"
    | "unfunded";
}

/**
 * The single diagnosis for a scan, following the spec's taxonomy:
 * healthy / no-pqc-key / no-window / exhausted / invalid.
 *
 * Precedence: an unreadable chain state beats everything (invalid); then the
 * missing key; then a stored-but-dead window (exhausted); then no window at
 * all; then healthy, which requires key + live window + positive balance.
 */
export function diagnose(s: HealthSignals): DiagnosisResult {
  if (!s.pqcReadable || !s.windowReadable) {
    return { diagnosis: "invalid", reason: "query-failed" };
  }
  if (!s.pqcRegistered) {
    return { diagnosis: "no-pqc-key", reason: "no-key" };
  }
  if (s.windowFound && !s.windowLive) {
    return { diagnosis: "exhausted", reason: "window-expired-or-used-up" };
  }
  if (!s.windowLive) {
    return { diagnosis: "no-window", reason: "no-window-open" };
  }
  if (s.balanceUqor === null) {
    return { diagnosis: "invalid", reason: "balance-unknown" };
  }
  if (s.balanceUqor === 0n) {
    return { diagnosis: "invalid", reason: "unfunded" };
  }
  return { diagnosis: "healthy", reason: "all-checks-pass" };
}

/** Plain-language copy for each diagnosis: what it means, what fixes it. */
export const DIAGNOSIS_COPY: Record<
  Diagnosis,
  { title: string; plain: string; fix: string }
> = {
  healthy: {
    title: "Healthy — ready for EVM transactions",
    plain:
      "This account has a registered post-quantum key, an open EVM window, and funds to pay fees.",
    fix: "No action needed. Watch the window: it expires after its block budget runs out.",
  },
  "no-pqc-key": {
    title: "No post-quantum key registered",
    plain:
      "This account has not registered its ML-DSA-87 key, so the chain will refuse its EVM transactions.",
    fix: "Register an ML-DSA-87 (Dilithium5) key first, then open an EVM window.",
  },
  "no-window": {
    title: "No EVM window open",
    plain:
      "The post-quantum key is registered, but no EVM authorisation window is open, so EVM transactions are refused.",
    fix: "Open an EVM window, bounded by blocks, transactions and value.",
  },
  exhausted: {
    title: "Window exhausted",
    plain:
      "A window existed for this account, but it ran out of blocks, transactions or value.",
    fix: "Open a fresh EVM window.",
  },
  invalid: {
    title: "Status could not be determined",
    plain:
      "The chain could not be read clearly enough to judge this account — or the account is quantum-ready but holds no funds to pay fees.",
    fix: "Check the query errors below, or fund the account if its balance is zero.",
  },
};

/** 1 QOR = 10^6 uqor. Format a uqor balance with exactly 6 decimals. */
export function formatQor(uqor: bigint | null): string {
  if (uqor === null) return "unknown";
  if (uqor < 0n) return "unknown";
  const whole = uqor / 1_000_000n;
  const frac = (uqor % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${frac}`;
}

/** 1 uqor = 10^12 wei. Convert an EVM wei balance to uqor, rounding down. */
export function weiToUqor(wei: bigint): bigint {
  return wei / 1_000_000_000_000n;
}

export interface ParsedAddress {
  /** Native bech32 form, `qor1...`. */
  qor: string;
  /** Lowercase EVM form, `0x...` — the same 20 bytes. */
  evm: `0x${string}`;
}

/**
 * Accept a `qor1...` or `0x...` address and return both forms.
 * Returns null for anything else. The SDK converters verify the bech32
 * checksum / hex shape and throw on bad input, so a bad address can never
 * silently become a different address.
 */
export function parseAddressInput(raw: string): ParsedAddress | null {
  const input = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) {
    try {
      const qor = toQorAddress(input);
      return { qor, evm: input.toLowerCase() as `0x${string}` };
    } catch {
      return null;
    }
  }
  // A qor1 address is "qor1" + 32 data chars + 6 checksum chars. The charset
  // check is deliberately loose here; the SDK's bech32 decode below enforces
  // the real charset and checksum.
  if (/^qor1[0-9a-z]{38}$/.test(input)) {
    try {
      const evm = toEvmAddress(input);
      return { qor: input, evm };
    } catch {
      return null;
    }
  }
  return null;
}

/** Algorithm id → display name (REST also returns the name; this is the fallback). */
export function algorithmName(algorithmId: number | null, restName: string | null): string | null {
  if (restName) {
    const lower = restName.toLowerCase();
    if (lower === "dilithium5") return "Dilithium5 (ML-DSA-87)";
    return restName;
  }
  if (algorithmId === 1) return "Dilithium5 (ML-DSA-87)";
  if (algorithmId === 2) return "ML-KEM-1024";
  if (algorithmId === null) return null;
  return `Algorithm ${algorithmId}`;
}
