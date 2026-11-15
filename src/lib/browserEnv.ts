/**
 * Browser-only network resolution (reads Vite env vars). Kept separate from
 * networks.ts so the Node test scripts can import networks.ts without
 * touching `import.meta.env`.
 *
 * - Default: testnet, REST through the dev/preview proxy at /lcd-testnet
 *   (the public REST endpoints send no CORS headers).
 * - VITE_NETWORK=devnet: local devnet, REST through /lcd-devnet and EVM RPC
 *   through /evm-devnet. Override the proxy targets with VITE_DEVNET_REST /
 *   VITE_DEVNET_EVM_RPC if your node listens elsewhere.
 */
import { NETWORKS, type NetworkConfig } from "./networks.js";

export function browserNetworkConfig(): NetworkConfig {
  const name = import.meta.env.VITE_NETWORK as string | undefined;
  if (name && name.toLowerCase() === "devnet") {
    return {
      ...NETWORKS.devnet,
      rest: (import.meta.env.VITE_DEVNET_REST as string | undefined) ?? "/lcd-devnet",
      evmRpc:
        (import.meta.env.VITE_DEVNET_EVM_RPC as string | undefined) ?? "/evm-devnet",
    };
  }
  return {
    ...NETWORKS.testnet,
    rest: "/lcd-testnet",
    evmRpc:
      (import.meta.env.VITE_TESTNET_EVM_RPC as string | undefined) ??
      NETWORKS.testnet.evmRpc,
  };
}
