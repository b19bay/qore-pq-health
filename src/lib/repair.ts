/**
 * Repair: compose the exact fix for a diagnosis and the exact commands that
 * execute it.
 *
 * Why commands instead of a one-click send? Both repairs are Cosmos-lane
 * messages — MsgRegisterPQCKeyV2 and MsgOpenEVMWindow — and the window
 * message must carry the account's hybrid (classical + ML-DSA-87) signature.
 * An EVM browser wallet (MetaMask, QoreX) cannot produce that signature:
 * the docs state it plainly ("a Cosmos-lane message, so it carries the PQC
 * signature that an Ethereum wallet cannot"). QoreX signing is not available
 * in the browser yet either. So this app does the honest thing: it composes
 * the exact message (bounds-checked by the SDK), prints the exact commands
 * for the user's own terminal — where their keys already live — and then
 * verifies the result on-chain by tx hash and re-scan. No key material is
 * ever asked for, pasted, or stored by this app.
 */
import {
  MAX_EVM_WINDOW_BLOCKS,
  MAX_EVM_WINDOW_TXS,
  openEvmWindowMessage,
  type OpenEvmWindowMessage,
} from "@qorechain/evm/window";

import type { NetworkConfig } from "./networks.js";

/** Sensible default window, matching the docs' worked example. */
export const DEFAULT_WINDOW = {
  blocks: 7200,
  maxTxs: 20,
  /** In whole QOR; converted to uqor when composing the message. */
  maxValueQor: 1000,
};

export const WINDOW_BOUNDS = {
  blocks: { min: 1, max: Number(MAX_EVM_WINDOW_BLOCKS) },
  maxTxs: { min: 1, max: Number(MAX_EVM_WINDOW_TXS) },
};

/** Gas limits from the docs (the 2,592-byte key needs the larger one). */
export const REGISTER_GAS = 600000;
export const WINDOW_GAS = 400000;

export interface RepairIdentity {
  /** The account being repaired, `qor1...`. */
  senderQor: string;
  /** Name of the classical key in the user's qorechaind keyring. */
  keyName: string;
  /** Name of the Dilithium-5 key in the user's qorechaind pqc store. */
  pqcKeyName: string;
}

/**
 * Compose the MsgOpenEVMWindow message for these parameters. The SDK checks
 * the chain's bounds first, so a bad value fails here — before it can cost a
 * refused transaction — with the SDK's own error message.
 */
export function composeOpenWindowMessage(
  senderQor: string,
  blocks: number,
  maxTxs: number,
  maxValueQor: number,
): OpenEvmWindowMessage {
  const maxValueUqor = BigInt(Math.round(maxValueQor * 1_000_000));
  return openEvmWindowMessage({
    sender: senderQor,
    blocks,
    maxTxs,
    maxValue: maxValueUqor,
  });
}

function nodeFlag(network: NetworkConfig): string {
  // The local devnet RPC is on localhost; public networks use the user's own
  // configured node, so no --node flag is printed for them.
  return network.id === "devnet" ? " --node http://localhost:26657" : "";
}

/**
 * The exact commands that register an ML-DSA-87 key. Step 1 generates the
 * keypair locally (the private half never leaves the user's machine) and
 * prints the public key hex; step 2 registers that hex on-chain. The first
 * registration is the one Cosmos-lane transaction a keyless account may sign
 * classically, so no cosign step is needed here.
 */
export function registerKeyCommands(
  identity: RepairIdentity,
  network: NetworkConfig,
): string[] {
  const node = nodeFlag(network);
  return [
    `qorechaind tx pqc gen-key ${identity.pqcKeyName}`,
    `# Copy the public key hex printed above, then run:`,
    `qorechaind tx pqc register-key-v2 dilithium5 <PUBKEY_HEX> hybrid --from ${identity.keyName} --pqc-key ${identity.pqcKeyName} --chain-id ${network.cosmosChainId} --gas ${REGISTER_GAS} --fees ${network.minFeeUqor}uqor -y${node}`,
  ];
}

/**
 * The exact commands that open an EVM window. The message is built unsigned
 * (--generate-only) and then hybrid-signed + broadcast by `cosign`, because
 * only the account's ML-DSA-87 key can authorise EVM spending.
 */
export function openWindowCommands(
  identity: RepairIdentity,
  network: NetworkConfig,
  blocks: number,
  maxTxs: number,
  maxValueQor: number,
): string[] {
  const node = nodeFlag(network);
  const fee = `${network.minFeeUqor}uqor`;
  return [
    `qorechaind tx pqc open-evm-window ${blocks} ${maxTxs} ${maxValueQor}qor --from ${identity.keyName} --chain-id ${network.cosmosChainId} --gas ${WINDOW_GAS} --fees ${fee} --generate-only > window.json${node}`,
    `qorechaind tx pqc cosign window.json --from ${identity.keyName} --pqc-key ${identity.pqcKeyName} --chain-id ${network.cosmosChainId} --fees ${fee} --gas ${WINDOW_GAS}${node}`,
  ];
}
