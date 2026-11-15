import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The public REST APIs send no CORS headers, so the browser reaches them
// through the dev (and preview) server. /lcd-testnet forwards to the public
// testnet REST endpoint; /lcd-devnet and /evm-devnet forward to a local
// devnet node (the stock devnet node does not serve REST — see README — but
// a node started with the API server enabled works through the same proxy).
// In production, serve the app behind a proxy that does the same.
// There is deliberately no mainnet proxy: this tool never touches mainnet.
const rest = (target: string) => ({
  target,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/lcd-(testnet|devnet)/, ""),
});
const proxy = {
  "/lcd-testnet": rest("https://api-testnet.qore.host"),
  "/lcd-devnet": rest("http://localhost:1317"),
  "/evm-devnet": {
    target: "http://localhost:8545",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/evm-devnet/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
});
