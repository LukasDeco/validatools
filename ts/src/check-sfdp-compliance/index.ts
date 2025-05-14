import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { JSDOM } from "jsdom";
import { Logger } from "../util/logger";

// Env validation
const mainnetIdentity = process.env.MAINNET_IDENTITY;
const testnetIdentity = process.env.TESTNET_IDENTITY;
if (!mainnetIdentity || !testnetIdentity) {
  console.error("Missing MAINNET_IDENTITY or TESTNET_IDENTITY env var");
  process.exit(1);
}

const logger = new Logger({
  telegramEnabled: process.env.TELEGRAM_ENABLED === "true",
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  prefix: "[ValidatorVersionCheck] ",
});

const VALIDATOR_VERSIONS_URL = "https://solana.org/delegation-criteria";

async function fetchRequiredVersions(
  network: "mainnet" | "testnet"
): Promise<{ epoch: number; agave: string; firedancer: string }[]> {
  const html = (await axios.get(VALIDATOR_VERSIONS_URL)).data;
  const dom = new JSDOM(html);
  const header = dom.window.document.querySelector(
    `#${network}-required-versions`
  );

  const headerParent = header?.parentElement;
  if (!headerParent) throw new Error("Could not find required version table.");

  const table = headerParent.querySelector("table");

  if (!table) throw new Error("Could not find required version table.");

  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const data = rows.map((row) => {
    const cells = row.querySelectorAll("td p");
    // console.log(Array.from(cells).map((c) => c.textContent));
    // console.log(Array.from(cells).map((c) => c.innerHTML));
    return {
      epoch: parseInt(cells[0].textContent || ""),
      agave: cells[1].textContent?.trim() || "",
      firedancer: cells[3].textContent?.trim() || "",
    };
  });

  return data;
}

async function fetchCurrentValidatorVersion(
  connection: Connection,
  voteAccountPk: PublicKey
): Promise<string | undefined> {
  const nodes = await connection.getClusterNodes();
  const match = nodes.find((node) => node.pubkey === voteAccountPk.toBase58());
  return match?.version;
}

function compareVersions(
  current: string,
  required: { agave: string; firedancer: string }
): boolean {
  // Detect if running Firedancer by checking version format (x.xxx.xxxxx)
  const isFiredancer = /^\d\.\d{3}\.\d{5}$/.test(current);

  // Compare against appropriate required version
  const requiredVersion = isFiredancer ? required.firedancer : required.agave;

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

async function checkNetwork(network: "mainnet" | "testnet") {
  const connection = new Connection(
    network === "mainnet"
      ? process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com"
      : process.env.TESTNET_RPC_URL || "https://api.testnet.solana.com",
    "confirmed"
  );

  const identityPk = new PublicKey(
    network === "mainnet" ? mainnetIdentity : testnetIdentity
  );

  const requiredVersions = await fetchRequiredVersions(network);
  const currentVersion = await fetchCurrentValidatorVersion(
    connection,
    identityPk
  );

  if (!currentVersion) {
    await logger.error(
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
    .sort((a, b) => b.epoch - a.epoch)[0];

  const isFiredancer = /^\d\.\d{3}\.\d{5}$/.test(currentVersion);
  const isValidCurrent = compareVersions(currentVersion, currentRequirement);
  const isValidNext = nextRequirement
    ? compareVersions(currentVersion, nextRequirement)
    : true;

  const report = [
    "",
    `🔍 ${network.toUpperCase()} Validator Version Check`,
    `Current epoch: ${currentEpoch.epoch}`,
    `Required ${isFiredancer ? "Firedancer" : "Agave"} version: ${
      isFiredancer ? currentRequirement.firedancer : currentRequirement.agave
    }`,
    `Your version: ${currentVersion}`,
    isValidCurrent
      ? `✅ Validator is running a sufficient version.`
      : `❌ Validator version is outdated!`,
  ];

  if (nextRequirement && !isValidNext) {
    report.push(
      `⚠️ Warning: Epoch ${nextRequirement.epoch} will require version ${
        isFiredancer ? nextRequirement.firedancer : nextRequirement.agave
      }`
    );
  }

  await logger.info(report.join("\n"));
}

async function main() {
  await checkNetwork("mainnet");
  await checkNetwork("testnet");
}

main().catch((err) => logger.error(`Fatal error: ${err.stack || err}`));
