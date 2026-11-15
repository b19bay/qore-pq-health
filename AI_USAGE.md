# AI Usage — how this entry was built

This entry is an **AI-native build**, submitted for the Best AI-Native Build
special award. This file documents honestly what the AI did, what the human
did, and how the work was verified — because "AI wrote it" is only a claim
worth making when the verification is real.

## The workflow

1. **Human (project owner) wrote the behaviour specification first.**
   `../SPEC.md` defines the entry before any code existed: the four features
   (Scan, Diagnosis, Repair, Window monitor), the exact scoring weights
   (+50/+30/+20) and grade boundaries, the five-label diagnosis taxonomy, the
   networks and endpoints, the test accounts, the mandatory tests (unit,
   live testnet read, devnet end-to-end repair), and the hard rules (no
   mainnet, no real funds, no credentials in files, no invented results).
   Every line of code traces back to that document.
2. **AI agent (Muse) implemented from the spec.** The agent scaffolded the
   project fresh with `create-qorechain-dapp`, then wrote all application
   code — the pure health logic, the live scan, the repair composition, the
   React UI, the unit tests, and the two test scripts — without reading any
   other project's code. The only external sources consulted were the
   official QoreChain documentation (docs.qorechain.io), the live testnet
   REST API (to verify response shapes), and the type definitions inside the
   scaffold's own `node_modules`.
3. **Human direction throughout.** The owner set the goal and the rules,
   chose the Quantum Pass category and the repair-not-just-report
   differentiator, supplied the devnet test accounts, and reviews the result.
   The agent did not choose the product direction; it executed a written
   spec and reported back for review.
4. **Verification is by execution, not by assertion.** Every claim in the
   README comes from a real run: 59 unit tests, a live testnet read test
   against two real addresses, a devnet end-to-end repair with on-chain
   transactions verified by DeliverTx code, and a production build served
   over HTTP. Where a run exposed a real bug — the agent's first E2E attempt
   mis-parsed the flat `query tx` CLI output (the REST endpoint wraps it in
   `tx_response`; the CLI does not) — the bug was fixed, the suite was
   re-run in full, and the fix is documented in the code. No test result was
   ever hand-written or edited to pass.

## What the AI did

- Designed the code layout (pure logic separated from I/O so the same
  scoring/diagnosis code is unit-tested, used by the UI, and reused by the
  Node test scripts).
- Wrote all source files, tests, scripts, and documentation in this repo.
- Researched the chain surface from official docs only: the PQC REST routes,
  the EVM window bounds and message shapes, the CLI flows for key
  registration and hybrid cosigning, and the documented fact that no EVM
  browser wallet can sign the Cosmos-lane repair messages — which is why
  repair is a guided, verified flow rather than a fake one-click button.
- Ran every test, diagnosed the failures (including the `query tx` parsing
  bug above and the `node --test` directory-form quirk), revised the code,
  and re-ran the full suite after the revision.

## What the human did

- Wrote the specification (`SPEC.md`) that the agent implemented.
- Defined the product idea (repair, not just report) and the category.
- Provided the devnet environment: the local node, the funded test accounts
  (`qp-test1`, `qp-test2`), and the `qorechaind` binary.
- Reviews the finished entry and owns the submission decision. The agent
  does not submit anything on its own.

## What the AI did NOT do

- It did not copy code from other entries or projects (it was forbidden to
  read them, and didn't).
- It did not invent test results, scores, or transaction hashes — every
  number in the README and receipts comes from a run the agent executed.
- It did not handle secrets: no mnemonic, private key, or credential was
  ever written to a file or pasted anywhere. The devnet PQC keypairs used by
  the E2E test live only in the devnet node's own key store, outside this
  repo, and are test keys for a local chain.
- It did not touch mainnet, real funds, or any paid service.

## Tools

- **Muse** (Meta's personal AI agent) — the implementing agent.
- **QoreChain docs** (docs.qorechain.io) — the only documentation source.
- **Live chain data** — testnet REST (`api-testnet.qore.host`,
  `evm-testnet.qore.host`) for read tests; local devnet node for the E2E
  repair test.
- **Scaffold & SDK** — `create-qorechain-dapp@0.14.0`,
  `@qorechain/evm@0.14.0`, `@qorechain/qorex-rainbowkit@0.1.0` (see README
  credits).
