import "dotenv/config";
import "@nomicfoundation/hardhat-viem";
import type { HardhatUserConfig } from "hardhat/config";

const privateKey = process.env.PRIVATE_KEY ?? "";
const normalizedPrivateKey =
  privateKey === "" ? "" : privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    somniaTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 50312,
      url: process.env.SOMNIA_RPC_URL ?? "https://api.infra.testnet.somnia.network",
      accounts: normalizedPrivateKey === "" ? [] : [normalizedPrivateKey],
    },
  },
};

export default config;
