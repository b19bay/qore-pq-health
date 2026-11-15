import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { DiagnosisPanel } from "./components/DiagnosisPanel.js";
import { RepairPanel } from "./components/RepairPanel.js";
import { ScanPanel } from "./components/ScanPanel.js";
import { WindowMonitor } from "./components/WindowMonitor.js";
import { browserNetworkConfig } from "./lib/browserEnv.js";
import { scanAddress, type ScanResult } from "./lib/scan.js";
import { muted } from "./components/styles.js";

export function App() {
  const network = useMemo(() => browserNetworkConfig(), []);
  const { address: connectedAddress } = useAccount();

  const [input, setInput] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [previousScan, setPreviousScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const doScan = useCallback(
    async (target?: string) => {
      const address = (target ?? input).trim();
      if (!address) return;
      setScanning(true);
      setScanError(null);
      try {
        const result = await scanAddress(address, network);
        // Before/after comparison for the repair panel: keep the earliest
        // scan of the SAME account (the pre-repair state) across re-scans;
        // a different account starts fresh with no "before".
        setPreviousScan((prev) => {
          if (prev && prev.qor === result.qor) return prev;
          if (scan && scan.qor === result.qor) return scan;
          return null;
        });
        setScan(result);
      } catch (e) {
        setScanError(e instanceof Error ? e.message : String(e));
      } finally {
        setScanning(false);
      }
    },
    [input, network, scan],
  );

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 780,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>Qore PQ Health</h1>
      <p style={muted}>
        Post-quantum health check — and repair — for QoreChain accounts. Scan any address to see
        its ML-DSA-87 key, EVM authorisation window and balance, get a plain-language diagnosis,
        and fix what is broken.
      </p>
      <p>
        Network: <strong>{network.label}</strong> (EVM chain {network.evmChainId}) ·{" "}
        <span style={muted}>testnet &amp; local devnet only — never mainnet.</span>
      </p>
      <ConnectButton />

      <ScanPanel
        value={input}
        onChange={setInput}
        onScan={() => void doScan()}
        scanning={scanning}
        scanError={scanError}
        scan={scan}
        networkLabel={network.label}
      />

      {scan && <DiagnosisPanel scan={scan} />}

      {scan && (
        <RepairPanel
          scan={scan}
          previousScan={previousScan}
          connectedAddress={connectedAddress}
          onRescan={() => void doScan(scan.qor)}
          rescanning={scanning}
        />
      )}

      <WindowMonitor address={connectedAddress} network={network} />

      <footer style={{ ...muted, marginTop: "2rem" }}>
        Reads are live chain data — nothing here is simulated. Repair transactions are composed
        and verified by this app and signed where your keys live; see the README for why a
        browser wallet cannot sign them (yet).
      </footer>
    </main>
  );
}
