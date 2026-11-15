# Qore PQ Health — Post-Quantum Health + Repair

**Build Before Q-Day (QoreChain Developer Fest) · Quantum Pass category**

A tool that doesn't just grade a QoreChain account's post-quantum readiness —
it **repairs** it. Scan any address, get a plain-language diagnosis of why its
next EVM transaction would fail, and walk the guided repair: register the
ML-DSA-87 key, open the EVM authorisation window, verify the fix on-chain,
and watch the score go to 100.

Other checkers stop at the report. This one closes the loop.

## What it does

1. **Scan** — paste any `qor1…` or `0x…` address (both name the same account)
   and read live chain data: PQC key registration (algorithm, registration
   height), EVM window status (open/closed, blocks and transactions left),
   balance in QOR, plus a **health score 0–100 and grade A–F**:
   +50 registered key, +30 live window, +20 funded.
2. **Diagnosis** — one verdict from a fixed taxonomy: `healthy`,
   `no-pqc-key`, `no-window`, `exhausted`, `invalid`, each with a
   one-sentence plain-language explanation and the suggested fix.
3. **Repair** — for each fixable diagnosis, the app composes the exact repair
   message (bounds-checked by the SDK), shows the exact commands to run where
   your keys live, verifies the resulting transaction on-chain by hash
   (DeliverTx code, raw chain log shown verbatim), and re-scans to show the
   before/after score.
4. **Window monitor** — the connected wallet's live window, auto-refreshed
   every 15 seconds, with a warning when fewer than 50 blocks remain.

Everything displayed comes from live chain queries. Nothing is simulated, and
no result is claimed for a network it wasn't tested on (see Testing).

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run preview  # serve the production build
```

The public REST endpoints send no CORS headers, so the dev and preview
servers proxy `/lcd-testnet` to `https://api-testnet.qore.host`
(`vite.config.ts`). In production, serve the app behind a proxy that does the
same.

## Networks

Default: **testnet** (`qorechain-diana`, EVM chain 9800). Mainnet is
deliberately not offered anywhere in the app — no mainnet chain, proxy, or
config exists.

Point the app at a **local devnet** without changing code:

```sh
VITE_NETWORK=devnet npm run dev
```

Optional overrides: `VITE_DEVNET_REST` (default `/lcd-devnet` → the Vite
proxy → `http://localhost:1317`), `VITE_DEVNET_EVM_RPC` (default
`/evm-devnet` → `http://localhost:8545`).

> The stock local devnet node does **not** serve REST on :1317, so browser
> scans in devnet mode fail with an honest connection error unless the node
> was started with the API server enabled. The devnet repair loop is instead
> verified by the CLI end-to-end test below, which is the devnet path by
> design.

## Testing

| Test | Command | What it proves |
| --- | --- | --- |
| Unit tests | `npm test` | Diagnosis + scoring logic: all 5 diagnoses, all 11 grade boundaries (0, 1, 29, 30, 49, 50, 69, 70, 89, 90, 100), score combinations, address validation incl. bad bech32 checksums. 59 tests, `node:test`, no network. |
| Live testnet read | `npm run test:live` | Read-only scan of two real testnet addresses: a validator account (key registered, Dilithium5, height 5040860, 85.824045 QOR → score 70, grade B, `no-window`) and an unregistered address (score 0, grade F, `no-pqc-key`). Cross-checks the EVM wei balance against the bank uqor balance. |
| E2E repair (devnet) | `npm run test:e2e` | Full repair loop on the local devnet with `qp-test1`: scan (`no-pqc-key`, 20) → register key → re-scan (`no-window`, 70) → open window → re-scan (`healthy`, 100). Every tx verified with `query tx` (DeliverTx code 0). Idempotent: re-runs skip completed steps and recover their tx hashes from the chain. Receipts in `scripts/e2e-receipt-<account>.json`. Override the account with `QP_E2E_ACCOUNT_NAME` / `QP_E2E_ACCOUNT_ADDRESS`. |
| Build + serve | `npm run build` + `npm run dev` | `tsc --noEmit` + Vite build exit 0; dev server serves the page (HTTP 200). |

Tested 15–16 Nov 2026 (all passing). Devnet E2E receipts:

- `qp-test1`: register `3711a43cc2c63f3b726c629daa761b5b9aebf68da99aa17514e7cb849d22e633`
  (height 10104) · window `c601ee68c53575ea33e5a19b020217fa97aa0f7a6b8fad00e3d22f18794711aa`
  (height 10145).
- `qp-test2` (single clean run): register
  `40c0c14748cba95f5f5e6d760272ed347e03220b0909628e63fa8926e9cab520`
  (height 10268) · window `690663ad25130db5ea560aef33a7bfa8a09d9d6614250f2bb1bdd1ce4ba71754`
  (height 10275).

**Honest scope note (updated 16 Nov 2026):** the repair loop is proven
end-to-end on the local devnet, AND the full repair flow was executed live
on testnet during the testnet deploy session: the faucet account went from
no key to key registered (`D0E1A296…`, height 10153399) and the deployer
account went from key-only to window opened (`1C91B8A5…`, height 10153607)
→ healthy. The app's own scan logic verified all three states on testnet
(deployer healthy 100/A, faucet no-window 70/B, no-key address no-pqc-key
0/F). The app itself still composes and verifies — it does not broadcast.

## Why repair is guided, not one-click

Both repairs are **Cosmos-lane messages** (`MsgRegisterPQCKeyV2`,
`MsgOpenEVMWindow`), and the window message must carry the account's hybrid
signature (classical + ML-DSA-87). No EVM browser wallet can produce that:
the QoreChain docs state it plainly — the window message "carries the PQC
signature that an Ethereum wallet cannot". QoreX in the browser is
connect + read only today (its EVM signing methods are not available yet),
and asking a user to paste a mnemonic or private key into a web page would be
a security failure, not a feature — this app never asks for, stores, or
writes any key material.

So the app does the verifiable part: it composes the exact message
(bounds-checked), prints the exact commands for the terminal where the user's
keys already live, verifies the broadcast transaction on-chain, and re-scans.
QoreX app users can also open a window from Settings → Security → EVM access
window. If a future wallet signs Cosmos-lane hybrid transactions in the
browser, the repair panel is the one place to wire it in.

## Known limitations

- **Repair needs a terminal (or the QoreX app)** for the signing step — see
  above. The app composes and verifies; it does not broadcast.
- **Devnet browser scans need REST enabled** on the local node (off by
  default); the CLI E2E test is the devnet verification path.
- **Testnet repair verified live 16 Nov 2026** (faucet QOR claimed; the
  full flow — register key → open window → healthy — was executed on
  testnet during the deploy session and scanned with the app's own logic;
  see `../../TESTNET-DEPLOY-LOG.md`).
- **Diagnosis edge case:** an account with a key + live window but exactly
  zero balance has no label in the five-label taxonomy, so it reports
  `invalid` with reason `unfunded` and a plain-language explanation, rather
  than being mislabelled as a key or window problem. See `src/lib/health.ts`.
- **Window monitor** reads over REST, so it shares the devnet REST caveat.
- The `preview`/`dev` proxy only covers the networks above; a production
  deployment needs its own proxy for the REST endpoints.

## Project layout

```
src/
  lib/
    health.ts     pure scoring / grading / diagnosis / address logic (unit-tested)
    networks.ts   testnet + devnet configs (no mainnet)
    browserEnv.ts browser-only env resolution (VITE_NETWORK=devnet)
    scan.ts       live REST scan + tx verification by hash
    repair.ts     repair message composition + exact CLI commands
  components/     ScanPanel, DiagnosisPanel, RepairPanel, WindowMonitor
  App.tsx         composition + wallet connection
  wagmi.ts        RainbowKit + QoreX + injected wallets, testnet chain only
tests/            node:test unit tests for src/lib/health.ts
scripts/
  live-testnet-scan.mjs    live read-only testnet test
  repair-e2e-devnet.mts    devnet end-to-end repair test (+ receipts)
```

## Credits

- Scaffold: `create-qorechain-dapp@0.14.0` (`viem-wagmi` template) — Vite +
  React + TypeScript + wagmi + RainbowKit.
- Chain SDK: `@qorechain/evm@0.14.0` (window helpers, address conversion,
  chain definitions) and `@qorechain/qorex-rainbowkit@0.1.0` (QoreX wallet).
- All other logic in this repo was written for this entry from the behaviour
  specification in `../SPEC.md` (see `AI_USAGE.md` for how).
- Chain documentation: https://docs.qorechain.io

## License

MIT — see `LICENSE`.
