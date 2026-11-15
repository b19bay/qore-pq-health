import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { qorechainTestnet } from "@qorechain/evm";
import { qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http } from "wagmi";

// QoreX first, then any other injected (EIP-1193) wallet. Neither uses
// WalletConnect, so the project id is only a placeholder unless you add a
// WalletConnect-based wallet.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [() => qorexWallet({ pollAccountsOnFocus: true }), injectedWallet],
    },
  ],
  {
    appName: "Qore PQ Health",
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "unused",
  },
);

// Single chain: the testnet only. This tool never touches mainnet, so the
// mainnet chain is deliberately not listed. In devnet mode
// (VITE_NETWORK=devnet) the local node serves the same EVM chain id (9800),
// so only the transport URL changes — via the /evm-devnet proxy, which
// forwards to the local node.
const isDevnet =
  (import.meta.env.VITE_NETWORK as string | undefined)?.toLowerCase() === "devnet";
const evmRpc = isDevnet
  ? ((import.meta.env.VITE_DEVNET_EVM_RPC as string | undefined) ?? "/evm-devnet")
  : ((import.meta.env.VITE_TESTNET_EVM_RPC as string | undefined) ?? undefined);

export const config = createConfig({
  chains: [qorechainTestnet],
  connectors,
  transports: {
    [qorechainTestnet.id]: evmRpc ? http(evmRpc) : http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
