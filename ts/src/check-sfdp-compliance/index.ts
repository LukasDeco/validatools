import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { Logger } from "../util/logger";

interface VersionRequirement {
  cluster: string;
  epoch: number;
  agave_max_version: string | null;
  agave_min_version: string;
  firedancer_min_version: string;
  firedancer_max_version: string | null;
  inherited_from_prev_epoch: boolean;
}

export class SFDPComplianceBot {
  // Env validation
  private mainnetIdentity: string;
  private testnetIdentity: string;
  private onlyLogIssues: boolean;
  private mainnetVersion?: string;
  private testnetVersion?: string;

  constructor(
    mainnetIdentity: string,
    testnetIdentity: string,
    onlyLogIssues = false,
    mainnetVersion?: string,
    testnetVersion?: string
  ) {
    if (!mainnetIdentity || !testnetIdentity) {
      console.error("Missing MAINNET_IDENTITY or TESTNET_IDENTITY env var");
      process.exit(1);
    }
    this.mainnetIdentity = mainnetIdentity;
    this.testnetIdentity = testnetIdentity;
    this.onlyLogIssues = onlyLogIssues;
    this.mainnetVersion = mainnetVersion;
    this.testnetVersion = testnetVersion;
  }

  logger = new Logger({
    telegramEnabled: process.env.TELEGRAM_ENABLED === "true",
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    prefix: "[ValidatorVersionCheck] ",
  });

  async fetchRequiredVersions(
    network: "mainnet" | "testnet"
  ): Promise<VersionRequirement[]> {
    const cluster = network === "mainnet" ? "mainnet-beta" : network;
    const response = await axios.get(
      `https://api.solana.org/api/epoch/required_versions?cluster=${cluster}`
    );
    return response.data.data;
  }

  async fetchCurrentValidatorVersion(
    connection: Connection,
    voteAccountPk: PublicKey,
    network: "mainnet" | "testnet"
  ): Promise<string | undefined> {
    // If version was provided in constructor, use that instead of fetching
    if (network === "mainnet" && this.mainnetVersion) {
      return this.mainnetVersion;
    }
    if (network === "testnet" && this.testnetVersion) {
      return this.testnetVersion;
    }

    // Otherwise fetch from RPC
    const nodes = await connection.getClusterNodes();
    const match = nodes.find(
      (node) => node.pubkey === voteAccountPk.toBase58()
    );
    return match?.version;
  }

  compareVersions(
    current: string,
    required: { agave_min_version: string; firedancer_min_version: string }
  ): boolean {
    // Detect if running Firedancer by checking version format (x.xxx.xxxxx)
    const isFiredancer = /^\d\.\d{3}\.\d{5}$/.test(current);

    // Compare against appropriate required version
    const requiredVersion = isFiredancer
      ? required.firedancer_min_version
      : required.agave_min_version;

    if (isFiredancer) {
      // For Firedancer, compare each part numerically
      const [currentMajor, currentMinor, currentPatch] = current
        .split(".")
        .map(Number);
      const [reqMajor, reqMinor, reqPatch] = requiredVersion
        .split(".")
        .map(Number);

      if (currentMajor > reqMajor) return true;
      if (currentMajor < reqMajor) return false;
      if (currentMinor > reqMinor) return true;
      if (currentMinor < reqMinor) return false;
      if (currentPatch >= reqPatch) return true;
      return false;
    } else {
      // For Agave, compare semver
      const normalize = (v: string) => v.replace(/[^\d.]/g, "");
      const [a, b] = [normalize(current), normalize(requiredVersion)];
      const aParts = a.split(".").map(Number);
      const bParts = b.split(".").map(Number);

      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] ?? 0;
        const bVal = bParts[i] ?? 0;
        if (aVal > bVal) return true;
        if (aVal < bVal) return false;
      }
      return true;
    }
  }

  async checkNetwork(network: "mainnet" | "testnet") {
    const connection = new Connection(
      network === "mainnet"
        ? process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com"
        : process.env.TESTNET_RPC_URL || "https://api.testnet.solana.com",
      "confirmed"
    );

    const identityPk = new PublicKey(
      network === "mainnet" ? this.mainnetIdentity : this.testnetIdentity
    );

    const requiredVersions = await this.fetchRequiredVersions(network);
    const currentVersion = await this.fetchCurrentValidatorVersion(
      connection,
      identityPk,
      network
    );

    if (!currentVersion) {
      await this.logger.error(
        `Could not find validator in ${network} vote account list.`
      );
      return;
    }

    // Get current epoch
    const currentEpoch = await connection.getEpochInfo();

    // Find current and next required versions
    const currentRequirement = requiredVersions
      .filter((v) => v.epoch <= currentEpoch.epoch)
      .sort((a, b) => b.epoch - a.epoch)[0];

    const nextRequirement = requiredVersions
      .filter((v) => v.epoch > currentEpoch.epoch)
      .sort((a, b) => a.epoch - b.epoch)[0];

    const isFiredancer = /^\d\.\d{3}\.\d{5}$/.test(currentVersion);
    const isValidCurrent = this.compareVersions(
      currentVersion,
      currentRequirement
    );
    const isValidNext = nextRequirement
      ? this.compareVersions(currentVersion, nextRequirement)
      : true;

    // Only proceed if there are issues or if we want to log everything
    if (
      !this.onlyLogIssues ||
      !isValidCurrent ||
      (nextRequirement && !isValidNext)
    ) {
      const report = [
        "",
        `🔍 ${network.toUpperCase()} Validator Version Check`,
        `Current epoch: ${currentEpoch.epoch}`,
        `Required ${isFiredancer ? "Firedancer" : "Agave"} version: ${
          isFiredancer
            ? currentRequirement.firedancer_min_version
            : currentRequirement.agave_min_version
        }`,
        `Your version: ${currentVersion}`,
        isValidCurrent
          ? `✅ Validator is running a sufficient version.`
          : `❌ Validator version is outdated!`,
      ];

      if (nextRequirement && !isValidNext) {
        report.push(
          `⚠️ Warning: Epoch ${nextRequirement.epoch} will require version ${
            isFiredancer
              ? nextRequirement.firedancer_min_version
              : nextRequirement.agave_min_version
          }`
        );
      }

      await this.logger.info(report.join("\n"));
    }
  }

  async run() {
    await this.checkNetwork("mainnet");
    await this.checkNetwork("testnet");
  }
}

async function main() {
  const mainnetIdentity = process.env.MAINNET_IDENTITY;
  const testnetIdentity = process.env.TESTNET_IDENTITY;
  const onlyLogIssues = process.env.ONLY_LOG_VERSION_ISSUES === "true";
  const mainnetVersion = process.env.MAINNET_VERSION;
  const testnetVersion = process.env.TESTNET_VERSION;
  const bot = new SFDPComplianceBot(
    mainnetIdentity,
    testnetIdentity,
    onlyLogIssues,
    mainnetVersion,
    testnetVersion
  );
  await bot.run();
}

// main().catch((err) => console.error(`Fatal error: ${err.stack || err}`));
