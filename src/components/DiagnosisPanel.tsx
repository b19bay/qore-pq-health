import { DIAGNOSIS_COPY } from "../lib/health.js";
import type { ScanResult } from "../lib/scan.js";
import { card, muted } from "./styles.js";

export function DiagnosisPanel({ scan }: { scan: ScanResult }) {
  const copy = DIAGNOSIS_COPY[scan.diagnosis];
  return (
    <section style={card}>
      <h2>2 · Diagnosis</h2>
      <p>
        <strong>{copy.title}</strong>{" "}
        <code style={muted}>({scan.diagnosis})</code>
      </p>
      <p>{copy.plain}</p>
      {scan.diagnosisReason === "unfunded" && (
        <p>
          The key and window are fine — the balance is exactly 0 QOR, so the account cannot pay
          any fee. Fund it first; nothing else needs fixing.
        </p>
      )}
      {scan.diagnosisReason === "query-failed" && (
        <p>
          At least one chain query failed, so no verdict is possible from this scan. The errors
          are listed in the scan results above — fix the connection and scan again.
        </p>
      )}
      <p>
        <strong>Suggested fix:</strong> {copy.fix}
      </p>
    </section>
  );
}
