/**
 * Network configuration. Testnet is the default; a local devnet is selectable
 * without code changes (see browserEnv.ts / README). Mainnet is deliberately
 * NOT offered: this tool only ever reads testnet and a local devnet.
 *
 * The `rest` / `evmRpc` values here are the direct endpoints, used by the
 * Node test scripts. The browser build goes through the Vite dev/preview
 * proxy instead (the public REST endpoints send no CORS headers) — see
 * browserEnv.ts, which overrides these with the proxy paths.
 */
export type NetworkId = "testnet" | "devnet";

export interface NetworkConfig {
  id: NetworkId;
  /** Human label shown in the UI. */
  label: string;
  /** Cosmos chain id, used in CLI repair commands. */
  cosmosChainId: string;
  /** EVM chain id (9800 on both testnet and the local devnet). */
  evmChainId: number;
  /** REST (LCD) base URL, no trailing slash. */
  rest: string;
  /** EVM JSON-RPC base URL, no trailing slash. */
  evmRpc: string;
  /** Minimum effective fee for one repair transaction, in uqor. */
  minFeeUqor: string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "Testnet · qorechain-diana",
    cosmosChainId: "qorechain-diana",
    evmChainId: 9800,
    rest: "https://api-testnet.qore.host",
    evmRpc: "https://evm-testnet.qore.host",
    minFeeUqor: "60000",
  },
  devnet: {
    id: "devnet",
    label: "Local devnet · qorechain-devnet",
    cosmosChainId: "qorechain-devnet",
    evmChainId: 9800,
    // NOTE: the stock local devnet node does NOT serve REST on :1317 (see
    // README). The browser build proxies /lcd-devnet there anyway, so a node
    // started with the API server enabled works; otherwise scans report the
    // connection error honestly and the CLI E2E script is the devnet path.
    rest: "http://localhost:1317",
    evmRpc: "http://localhost:8545",
    minFeeUqor: "50000",
  },
};

/** Resolve a network name to its config; anything unknown falls back to testnet. */
export function resolveNetwork(name: string | undefined | null): NetworkConfig {
  if (name && name.toLowerCase() === "devnet") return NETWORKS.devnet;
  return NETWORKS.testnet;
}
