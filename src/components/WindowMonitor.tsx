import { evmWindowStatus } from "@qorechain/evm/window";
import { useQuery } from "@tanstack/react-query";

import { formatQor } from "../lib/health.js";
import type { NetworkConfig } from "../lib/networks.js";
import { button, card, errorText, muted, warnBox } from "./styles.js";

/** Warn when the live window is about to run out of blocks. */
export const EXPIRY_WARNING_BLOCKS = 50n;

interface Props {
  address: `0x${string}` | undefined;
  network: NetworkConfig;
}

export function WindowMonitor({ address, network }: Props) {
  const { data, error, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["window-monitor", network.id, address],
    queryFn: () => evmWindowStatus({ rest: network.rest, address: address! }),
    enabled: address !== undefined,
    refetchInterval: 15_000,
  });

  return (
    <section style={card}>
      <h2>4 · Window monitor</h2>
      {!address && <p style={muted}>Connect a wallet to watch its EVM window live.</p>}
      {address && (
        <>
          <p style={muted}>
            Watching <code>{address}</code> on {network.label} — auto-refresh every 15 seconds.
          </p>
          {isLoading && <p>Reading the window…</p>}
          {error && (
            <p style={errorText}>Could not read the window: {error.message}</p>
          )}
          {data && !data.found && (
            <p>
              <strong>No window open.</strong> This account cannot send EVM transactions until one
              is opened — scan it above to start the repair.
            </p>
          )}
          {data && data.found && !data.live && (
            <p>
              <strong>Window closed.</strong> A window exists but it is exhausted or expired (
              {data.remainingBlocks.toString()} blocks, {data.remainingTxs.toString()} transactions
              left).
            </p>
          )}
          {data && data.found && data.live && (
            <>
              <p>
                <strong>Window open:</strong> {data.remainingBlocks.toString()} blocks,{" "}
                {data.remainingTxs.toString()} transactions, {formatQor(data.remainingValue)} QOR
                of value left.
              </p>
              {data.remainingBlocks < EXPIRY_WARNING_BLOCKS && (
                <div style={warnBox}>
                  <strong>Expiring soon:</strong> fewer than {EXPIRY_WARNING_BLOCKS.toString()}{" "}
                  blocks left in this window. Open a fresh one before it closes.
                </div>
              )}
            </>
          )}
          <button
            style={{ ...button, marginTop: "0.5rem" }}
            type="button"
            onClick={() => void refetch()}
            disabled={isRefetching}
          >
            {isRefetching ? "Refreshing…" : "Refresh now"}
          </button>
        </>
      )}
    </section>
  );
}
