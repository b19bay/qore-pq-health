/**
 * Unit tests for the pure health logic (src/lib/health.ts).
 * No network access. Run with: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  algorithmName,
  computeScore,
  diagnose,
  formatQor,
  gradeFor,
  parseAddressInput,
  weiToUqor,
  type HealthSignals,
} from "../src/lib/health.ts";

function signals(over: Partial<HealthSignals>): HealthSignals {
  return {
    pqcRegistered: false,
    windowFound: false,
    windowLive: false,
    remainingTxs: 0n,
    remainingBlocks: 0n,
    balanceUqor: 0n,
    pqcReadable: true,
    windowReadable: true,
    ...over,
  };
}

describe("computeScore", () => {
  it("scores 0 for an empty account", () => {
    assert.equal(computeScore(signals({})), 0);
  });
  it("awards +50 for a registered key", () => {
    assert.equal(computeScore(signals({ pqcRegistered: true })), 50);
  });
  it("awards +30 for a live window", () => {
    assert.equal(computeScore(signals({ windowLive: true, windowFound: true })), 30);
  });
  it("awards +20 for a positive balance", () => {
    assert.equal(computeScore(signals({ balanceUqor: 1n })), 20);
  });
  it("awards 70 for key + balance without a window", () => {
    assert.equal(
      computeScore(signals({ pqcRegistered: true, balanceUqor: 10_000_000n })),
      70,
    );
  });
  it("awards 80 for key + live window without funds", () => {
    assert.equal(
      computeScore(
        signals({ pqcRegistered: true, windowLive: true, windowFound: true }),
      ),
      80,
    );
  });
  it("awards 100 for key + live window + funds", () => {
    assert.equal(
      computeScore(
        signals({
          pqcRegistered: true,
          windowLive: true,
          windowFound: true,
          balanceUqor: 10_000_000n,
        }),
      ),
      100,
    );
  });
  it("does not award the balance points when the balance read failed", () => {
    assert.equal(
      computeScore(
        signals({
          pqcRegistered: true,
          windowLive: true,
          windowFound: true,
          balanceUqor: null,
        }),
      ),
      80,
    );
  });
});

describe("gradeFor — every boundary", () => {
  const cases: Array<[number, string]> = [
    [0, "F"],
    [1, "E"],
    [29, "E"],
    [30, "D"],
    [49, "D"],
    [50, "C"],
    [69, "C"],
    [70, "B"],
    [89, "B"],
    [90, "A"],
    [100, "A"],
  ];
  for (const [score, grade] of cases) {
    it(`gradeFor(${score}) is ${grade}`, () => {
      assert.equal(gradeFor(score), grade);
    });
  }
});

describe("diagnose — all five diagnoses", () => {
  it("healthy: key + live window + funds", () => {
    assert.deepEqual(
      diagnose(
        signals({
          pqcRegistered: true,
          windowFound: true,
          windowLive: true,
          remainingTxs: 5n,
          remainingBlocks: 100n,
          balanceUqor: 10_000_000n,
        }),
      ),
      { diagnosis: "healthy", reason: "all-checks-pass" },
    );
  });
  it("no-pqc-key: no key registered", () => {
    assert.deepEqual(diagnose(signals({ balanceUqor: 10_000_000n })), {
      diagnosis: "no-pqc-key",
      reason: "no-key",
    });
  });
  it("no-window: key registered, no window stored", () => {
    assert.deepEqual(
      diagnose(signals({ pqcRegistered: true, balanceUqor: 10_000_000n })),
      { diagnosis: "no-window", reason: "no-window-open" },
    );
  });
  it("exhausted: window stored but dead (0 txs left)", () => {
    assert.deepEqual(
      diagnose(
        signals({
          pqcRegistered: true,
          windowFound: true,
          windowLive: false,
          remainingTxs: 0n,
          remainingBlocks: 500n,
          balanceUqor: 10_000_000n,
        }),
      ),
      { diagnosis: "exhausted", reason: "window-expired-or-used-up" },
    );
  });
  it("exhausted: window stored but expired (0 blocks left)", () => {
    assert.deepEqual(
      diagnose(
        signals({
          pqcRegistered: true,
          windowFound: true,
          windowLive: false,
          remainingTxs: 5n,
          remainingBlocks: 0n,
          balanceUqor: 10_000_000n,
        }),
      ),
      { diagnosis: "exhausted", reason: "window-expired-or-used-up" },
    );
  });
  it("invalid: PQC query failed", () => {
    assert.deepEqual(diagnose(signals({ pqcReadable: false })), {
      diagnosis: "invalid",
      reason: "query-failed",
    });
  });
  it("invalid: window query failed", () => {
    assert.deepEqual(
      diagnose(signals({ pqcRegistered: true, windowReadable: false })),
      { diagnosis: "invalid", reason: "query-failed" },
    );
  });
  it("invalid: balance unknown despite key + live window", () => {
    assert.deepEqual(
      diagnose(
        signals({
          pqcRegistered: true,
          windowFound: true,
          windowLive: true,
          balanceUqor: null,
        }),
      ),
      { diagnosis: "invalid", reason: "balance-unknown" },
    );
  });
  it("invalid (unfunded): key + live window but exactly zero balance", () => {
    assert.deepEqual(
      diagnose(
        signals({
          pqcRegistered: true,
          windowFound: true,
          windowLive: true,
          balanceUqor: 0n,
        }),
      ),
      { diagnosis: "invalid", reason: "unfunded" },
    );
  });
  it("missing key beats an unreadable window (key checked first)", () => {
    // A failed window read is invalid even when the key is also missing:
    // unreadable state beats every other verdict.
    assert.deepEqual(
      diagnose(signals({ pqcRegistered: false, windowReadable: false })),
      { diagnosis: "invalid", reason: "query-failed" },
    );
  });
});

describe("formatQor", () => {
  it("formats zero", () => assert.equal(formatQor(0n), "0.000000"));
  it("formats one uqor", () => assert.equal(formatQor(1n), "0.000001"));
  it("formats exactly one QOR", () => assert.equal(formatQor(1_000_000n), "1.000000"));
  it("formats a real balance", () => assert.equal(formatQor(85_824_045n), "85.824045"));
  it("formats ten QOR", () => assert.equal(formatQor(10_000_000n), "10.000000"));
  it("reports an unknown balance", () => assert.equal(formatQor(null), "unknown"));
});

describe("weiToUqor", () => {
  it("converts 1 uqor of wei", () => {
    assert.equal(weiToUqor(1_000_000_000_000n), 1n);
  });
  it("rounds down below one uqor", () => {
    assert.equal(weiToUqor(999_999_999_999n), 0n);
  });
  it("converts a real EVM balance to the matching uqor amount", () => {
    assert.equal(weiToUqor(85_824_045n * 1_000_000_000_000n), 85_824_045n);
  });
});

describe("algorithmName", () => {
  it("prefers the REST name for dilithium5", () => {
    assert.equal(algorithmName(1, "dilithium5"), "Dilithium5 (ML-DSA-87)");
  });
  it("falls back to the id when no name is given", () => {
    assert.equal(algorithmName(2, null), "ML-KEM-1024");
    assert.equal(algorithmName(1, null), "Dilithium5 (ML-DSA-87)");
  });
  it("returns null when nothing is known", () => {
    assert.equal(algorithmName(null, null), null);
  });
  it("names unknown ids plainly", () => {
    assert.equal(algorithmName(9, null), "Algorithm 9");
  });
});

describe("parseAddressInput", () => {
  // A real testnet validator account (verified against the live REST API):
  // qor1q0f4cz33f8sfmvjglh67vwdhsfdukgyvxh0dxp == 0x03d35c0a3149e09db248fdf5e639b7825bcb208c
  const qor = "qor1q0f4cz33f8sfmvjglh67vwdhsfdukgyvxh0dxp";
  const evm = "0x03d35c0a3149e09db248fdf5e639b7825bcb208c";

  it("accepts a qor1 address and returns both forms", () => {
    assert.deepEqual(parseAddressInput(qor), { qor, evm });
  });
  it("accepts a 0x address and returns both forms", () => {
    assert.deepEqual(parseAddressInput(evm), { qor, evm });
  });
  it("accepts an uppercase 0x address (normalised to lowercase)", () => {
    assert.deepEqual(parseAddressInput(evm.toUpperCase().replace("0X", "0x")), {
      qor,
      evm,
    });
  });
  it("round-trips: qor -> evm -> qor", () => {
    const first = parseAddressInput("qor1v5fjclk5sgtdyfs3m4ptjc66pz27376sxcccx7");
    assert.notEqual(first, null);
    const second = parseAddressInput(first!.evm);
    assert.deepEqual(second, first);
  });
  it("trims surrounding whitespace", () => {
    assert.deepEqual(parseAddressInput(`  ${qor}\n`), { qor, evm });
  });

  const invalid = [
    "",
    "   ",
    "hello",
    "0x123",
    "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    "0x03d35c0a3149e09db248fdf5e639b7825bcb208", // 39 hex chars
    "0x03d35c0a3149e09db248fdf5e639b7825bcb208c00", // 42 hex chars
    "qor1q0f4cz33f8sfmvjglh67vwdhsfdukgyvxh0dxq", // bad bech32 checksum
    "qor1q0f4cz33f8sfmvjglh67vwdhsfdukgyvxh0d", // too short
    "qorvaloper1q0f4cz33f8sfmvjglh67vwdhsfdukgyv6j98m0", // wrong prefix
    "cosmos1q0f4cz33f8sfmvjglh67vwdhsfdukgyvxh0dxp", // wrong prefix
    "qor1Q0F4CZ33F8SFMVJGLH67VW DHSFDUKGYVXH0DXP", // space + uppercase
  ];
  for (const bad of invalid) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.equal(parseAddressInput(bad), null);
    });
  }
});
