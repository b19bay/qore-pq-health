import { useMemo, useState } from "react";

import { formatQor } from "../lib/health.js";
import {
  DEFAULT_WINDOW,
  WINDOW_BOUNDS,
  WINDOW_GAS,
  composeOpenWindowMessage,
  openWindowCommands,
  registerKeyCommands,
} from "../lib/repair.js";
import { verifyTx, type ScanResult, type TxVerification } from "../lib/scan.js";
import {
  button,
  card,
  errorText,
  input,
  mono,
  muted,
  okBox,
  pre,
  row,
  warnBox,
} from "./styles.js";

interface Props {
  scan: ScanResult;
  previousScan: ScanResult | null;
  connectedAddress: `0x${string}` | undefined;
  onRescan: () => void;
  rescanning: boolean;
}

export function RepairPanel({ scan, previousScan, connectedAddress, onRescan, rescanning }: Props) {
  const [keyName, setKeyName] = useState("mykey");
  const [pqcKeyName, setPqcKeyName] = useState("mypqc");
  const [blocks, setBlocks] = useState(DEFAULT_WINDOW.blocks);
  const [maxTxs, setMaxTxs] = useState(DEFAULT_WINDOW.maxTxs);
  const [maxValueQor, setMaxValueQor] = useState(DEFAULT_WINDOW.maxValueQor);
  const [txHash, setTxHash] = useState("");
  const [verification, setVerification] = useState<TxVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const repairable = scan.diagnosis === "no-pqc-key" || scan.diagnosis === "no-window" || scan.diagnosis === "exhausted";
  const needsKey = scan.diagnosis === "no-pqc-key";
  const needsWindow = scan.diagnosis === "no-window" || scan.diagnosis === "exhausted";

  const messagePreview = useMemo(() => {
    if (!needsWindow) return null;
    try {
      return {
        ok: true as const,
        json: JSON.stringify(
          composeOpenWindowMessage(scan.qor, blocks, maxTxs, maxValueQor),
          null,
          2,
        ),
      };
    } catch (e) {
      return { ok: false as const, json: e instanceof Error ? e.message : String(e) };
    }
  }, [needsWindow, scan.qor, blocks, maxTxs, maxValueQor]);

  const commands = useMemo(() => {
    const identity = { senderQor: scan.qor, keyName: keyName.trim() || "mykey", pqcKeyName: pqcKeyName.trim() || "mypqc" };
    if (needsKey) return registerKeyCommands(identity, scan.network);
    if (needsWindow) return openWindowCommands(identity, scan.network, blocks, maxTxs, maxValueQor);
    return [];
  }, [needsKey, needsWindow, scan, keyName, pqcKeyName, blocks, maxTxs, maxValueQor]);

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  }

  async function onVerify() {
    setVerifying(true);
    setVerification(null);
    const result = await verifyTx(scan.network.rest, txHash);
    setVerification(result);
    setVerifying(false);
  }

  const addressMismatch =
    connectedAddress !== undefined && connectedAddress.toLowerCase() !== scan.evm.toLowerCase();

  return (
    <section style={card}>
      <h2>3 · Repair</h2>

      {!repairable && (
        <p>
          {scan.diagnosis === "healthy"
            ? "Nothing to repair — this account is healthy."
            : "No repair action applies to this diagnosis. See the diagnosis above for what to do next."}
        </p>
      )}

      {repairable && !connectedAddress && (
        <div style={warnBox}>
          <strong>Connect wallet to repair.</strong> Use the Connect button at the top — repair
          acts on the connected account, and the app needs to know which account that is.
        </div>
      )}

      {repairable && connectedAddress && (
        <>
          {addressMismatch && (
            <div style={warnBox}>
              <strong>Heads up:</strong> the connected wallet ({connectedAddress}) is not the
              scanned account ({scan.evm}). The commands below repair the <em>scanned</em>{" "}
              account — make sure the key names you enter belong to that account, or scan the
              connected account instead.
            </div>
          )}

          <p>
            {needsKey ? (
              <>
                This account needs an <strong>ML-DSA-87 key registration</strong>{" "}
                (<code>MsgRegisterPQCKeyV2</code>, Dilithium5). The keypair is generated on your
                own machine — the private half never leaves it — and the registration is the one
                transaction a keyless account may sign classically.
              </>
            ) : (
              <>
                This account needs a fresh <strong>EVM authorisation window</strong>{" "}
                (<code>MsgOpenEVMWindow</code>). Pick its bounds below; the message is checked
                against the chain&apos;s limits before anything is shown.
              </>
            )}
          </p>

          <div style={row}>
            <label>
              Keyring key name{" "}
              <input
                style={{ ...input, minWidth: 120, flex: "none" }}
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                aria-label="Keyring key name"
              />
            </label>
            <label>
              PQC key name{" "}
              <input
                style={{ ...input, minWidth: 120, flex: "none" }}
                value={pqcKeyName}
                onChange={(e) => setPqcKeyName(e.target.value)}
                aria-label="PQC key name"
              />
            </label>
          </div>

          {needsWindow && (
            <div style={{ ...row, marginTop: "0.75rem" }}>
              <label>
                Blocks ({WINDOW_BOUNDS.blocks.min}–{WINDOW_BOUNDS.blocks.max}){" "}
                <input
                  style={{ ...input, minWidth: 90, flex: "none" }}
                  type="number"
                  min={WINDOW_BOUNDS.blocks.min}
                  max={WINDOW_BOUNDS.blocks.max}
                  value={blocks}
                  onChange={(e) => setBlocks(Number(e.target.value))}
                  aria-label="Window blocks"
                />
              </label>
              <label>
                Max txs ({WINDOW_BOUNDS.maxTxs.min}–{WINDOW_BOUNDS.maxTxs.max}){" "}
                <input
                  style={{ ...input, minWidth: 80, flex: "none" }}
                  type="number"
                  min={WINDOW_BOUNDS.maxTxs.min}
                  max={WINDOW_BOUNDS.maxTxs.max}
                  value={maxTxs}
                  onChange={(e) => setMaxTxs(Number(e.target.value))}
                  aria-label="Window max transactions"
                />
              </label>
              <label>
                Max value (QOR){" "}
                <input
                  style={{ ...input, minWidth: 90, flex: "none" }}
                  type="number"
                  min={1}
                  value={maxValueQor}
                  onChange={(e) => setMaxValueQor(Number(e.target.value))}
                  aria-label="Window max value in QOR"
                />
              </label>
            </div>
          )}

          {messagePreview && (
            <>
              <h3>Message to be signed (bounds-checked)</h3>
              {messagePreview.ok ? (
                <pre style={pre}>{messagePreview.json}</pre>
              ) : (
                <p style={errorText}>Invalid window parameters: {messagePreview.json}</p>
              )}
            </>
          )}

          <h3>Run these commands in your terminal</h3>
          <p style={muted}>
            Signing happens where your keys live — a browser wallet cannot sign these Cosmos-lane
            messages (the window message needs your ML-DSA-87 key, which no EVM wallet holds).
            The app never asks for your keys. QoreX app users can also open a window from
            Settings → Security → EVM access window.
          </p>
          <pre style={pre}>{commands.join("\n")}</pre>
          <div style={row}>
            <button style={button} type="button" onClick={() => void copy(commands.join("\n"), "all")}>
              {copied === "all" ? "Copied!" : "Copy all commands"}
            </button>
          </div>
          <p style={muted}>
            Fees: about {formatQor(BigInt(scan.network.minFeeUqor))} QOR per transaction
            {needsWindow ? ` (gas limit ${WINDOW_GAS.toLocaleString()})` : " (gas limit 600,000)"}.
          </p>

          <h3>Verify the repair</h3>
          <div style={row}>
            <input
              style={input}
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="Paste the repair transaction hash (64 hex characters)"
              aria-label="Repair transaction hash"
            />
            <button style={button} type="button" onClick={() => void onVerify()} disabled={verifying || !txHash.trim()}>
              {verifying ? "Checking…" : "Verify tx"}
            </button>
          </div>
          {verification && (
            <div style={verification.found && verification.code === 0 ? okBox : warnBox}>
              {verification.error && <p style={errorText}>{verification.error}</p>}
              {verification.found && (
                <p style={mono}>
                  Tx found at height {verification.height ?? "?"} — DeliverTx code{" "}
                  {verification.code ?? "?"} (
                  {verification.code === 0 ? "success" : "FAILED"})
                  {verification.code !== 0 && verification.rawLog ? (
                    <>
                      <br />
                      Chain log (verbatim): {verification.rawLog}
                    </>
                  ) : null}
                </p>
              )}
            </div>
          )}

          <div style={{ marginTop: "1rem" }}>
            <button style={button} type="button" onClick={onRescan} disabled={rescanning}>
              {rescanning ? "Re-scanning…" : "I ran it — re-scan now"}
            </button>
            {previousScan && (
              <p>
                Score before repair: <strong>{previousScan.score} / 100</strong> ({previousScan.diagnosis})
                {" → "}
                now: <strong>{scan.score} / 100</strong> ({scan.diagnosis})
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
