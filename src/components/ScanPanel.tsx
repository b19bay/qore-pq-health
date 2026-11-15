import { algorithmName, formatQor } from "../lib/health.js";
import type { ScanResult } from "../lib/scan.js";
import { button, card, errorText, gradeColors, input, mono, muted, row } from "./styles.js";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onScan: () => void;
  scanning: boolean;
  scanError: string | null;
  scan: ScanResult | null;
  networkLabel: string;
}

export function ScanPanel({ value, onChange, onScan, scanning, scanError, scan, networkLabel }: Props) {
  return (
    <section style={card}>
      <h2>1 · Scan</h2>
      <p style={muted}>
        Check any address on {networkLabel}. Paste a native <code>qor1…</code> address or an
        EVM <code>0x…</code> address — both name the same account.
      </p>
      <div style={row}>
        <input
          style={input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onScan();
          }}
          placeholder="qor1… or 0x…"
          aria-label="Address to scan"
        />
        <button style={button} type="button" onClick={onScan} disabled={scanning || !value.trim()}>
          {scanning ? "Scanning…" : "Scan"}
        </button>
      </div>
      {scanError && (
        <p style={errorText}>{scanError}</p>
      )}

      {scan && (
        <div style={{ marginTop: "1rem" }}>
          <p>
            Native: <code style={mono}>{scan.qor}</code>
            <br />
            EVM: <code style={mono}>{scan.evm}</code>
          </p>
          <p>
            Health score:{" "}
            <strong style={{ color: gradeColors[scan.grade], fontSize: "1.4rem" }}>
              {scan.score} / 100 · Grade {scan.grade}
            </strong>{" "}
            <span style={muted}>
              (+50 key, +30 live window, +20 funded)
            </span>
          </p>
          <ul>
            <li>
              <strong>PQC key:</strong>{" "}
              {scan.pqcError ? (
                <span style={errorText}>query failed: {scan.pqcError}</span>
              ) : scan.pqc.registered ? (
                <>
                  registered — {algorithmName(scan.pqc.algorithmId, scan.pqc.algorithmName) ?? "unknown algorithm"}
                  {scan.pqc.createdAtHeight ? `, registered at height ${scan.pqc.createdAtHeight}` : ""}
                  {scan.pqc.keyType ? ` (${scan.pqc.keyType})` : ""}
                </>
              ) : (
                "not registered"
              )}
            </li>
            <li>
              <strong>EVM window:</strong>{" "}
              {scan.windowError ? (
                <span style={errorText}>query failed: {scan.windowError}</span>
              ) : !scan.window || !scan.window.found ? (
                "closed — no window stored for this account"
              ) : scan.window.live ? (
                <>
                  open — {scan.window.remainingBlocks.toString()} blocks,{" "}
                  {scan.window.remainingTxs.toString()} transactions,{" "}
                  {formatQor(scan.window.remainingValue)} QOR of value left
                  {scan.window.nativeOnly ? " (native transfers only)" : ""}
                </>
              ) : (
                <>
                  closed — a window exists but it is exhausted or expired (
                  {scan.window.remainingBlocks.toString()} blocks,{" "}
                  {scan.window.remainingTxs.toString()} transactions left)
                </>
              )}
            </li>
            <li>
              <strong>Balance:</strong>{" "}
              {scan.balanceError ? (
                <span style={errorText}>query failed: {scan.balanceError}</span>
              ) : (
                `${formatQor(scan.balanceUqor)} QOR`
              )}
            </li>
          </ul>
          <p style={muted}>
            Scanned {new Date(scan.scannedAt).toLocaleString()} on {scan.network.label}.
          </p>
        </div>
      )}
    </section>
  );
}
