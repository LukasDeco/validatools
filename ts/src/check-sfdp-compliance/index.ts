import { Connection, PublicKey } from '@solana/web3.js';
import { Logger } from '../util/logger';

interface VersionRequirement {
  cluster: string;
  epoch: number;
  agave_max_version: string | null;
  agave_min_version: string;
  firedancer_min_version: string;
  firedancer_max_version: string | null;
  inherited_from_prev_epoch: boolean;
}

/**
 * Parse Firedancer version strings from RPC into a comparable 4-tuple.
 * Supports legacy `0.902.40002` (patch is 5 digits) and semver-style
 * `0.902.0-beta.40002` / `0.909.0-rc.40001` (prerelease carries the 5-digit build).
 */
function parseFiredancerVersion(
  v: string
): [number, number, number, number] | null {
  const s = v.trim();
  const prerelease = /^(\d+)\.(\d+)\.(\d+)-[0-9A-Za-z-]+\.(\d{5})$/.exec(s);
  if (prerelease) {
    return [+prerelease[1], +prerelease[2], +prerelease[3], +prerelease[4]];
  }
  const legacy = /^(\d+)\.(\d+)\.(\d{5})$/.exec(s);
  if (legacy) {
    return [+legacy[1], +legacy[2], 0, +legacy[3]];
  }
  return null;
}

function isFiredancerVersionString(v: string): boolean {
  return parseFiredancerVersion(v) !== null;
}

function getTelegramAlertChatId(): string | undefined {
  return (
    process.env.TELEGRAM_ALERT_CHAT_ID?.trim() ||
    process.env.TELEGRAM_CHAT_ID?.trim()
  );
}

function compareFiredancerTuples(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
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
      console.error('Missing MAINNET_IDENTITY or TESTNET_IDENTITY env var');
      process.exit(1);
    }
    this.mainnetIdentity = mainnetIdentity;
    this.testnetIdentity = testnetIdentity;
    this.onlyLogIssues = onlyLogIssues;
    this.mainnetVersion = mainnetVersion;
    this.testnetVersion = testnetVersion;
  }

  logger = new Logger({
    telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: getTelegramAlertChatId(),
    prefix: '[ValidatorVersionCheck] ',
  });

  async fetchRequiredVersions(
    network: 'mainnet' | 'testnet'
  ): Promise<VersionRequirement[]> {
    const cluster = network === 'mainnet' ? 'mainnet-beta' : network;
    const url = `https://api.solana.org/api/epoch/required_versions?cluster=${cluster}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `required_versions ${res.status}: ${await res.text().catch(() => '')}`
      );
    }
    const json = (await res.json()) as { data: VersionRequirement[] };
    return json.data;
  }

  async fetchCurrentValidatorVersion(
    connection: Connection,
    voteAccountPk: PublicKey,
    network: 'mainnet' | 'testnet'
  ): Promise<string | undefined> {
    // If version was provided in constructor, use that instead of fetching
    if (network === 'mainnet' && this.mainnetVersion) {
      return this.mainnetVersion;
    }
    if (network === 'testnet' && this.testnetVersion) {
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
    const fdCurrent = parseFiredancerVersion(current);
    const fdRequired = parseFiredancerVersion(required.firedancer_min_version);

    if (fdCurrent !== null) {
      if (fdRequired !== null) {
        return compareFiredancerTuples(fdCurrent, fdRequired) >= 0;
      }
      // API minimum not in a known Firedancer shape; treat as satisfied to avoid false Agave compare
      return true;
    }

    const requiredVersion = required.agave_min_version;

    // For Agave, compare semver
    const normalize = (v: string) => v.replace(/[^\d.]/g, '');
    const [a, b] = [normalize(current), normalize(requiredVersion)];
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] ?? 0;
      const bVal = bParts[i] ?? 0;
      if (aVal > bVal) return true;
      if (aVal < bVal) return false;
    }
    return true;
  }

  async checkNetwork(network: 'mainnet' | 'testnet') {
    const connection = new Connection(
      network === 'mainnet'
        ? process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com'
        : process.env.TESTNET_RPC_URL || 'https://api.testnet.solana.com',
      'confirmed'
    );

    const identityPk = new PublicKey(
      network === 'mainnet' ? this.mainnetIdentity : this.testnetIdentity
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

    const isFiredancer = isFiredancerVersionString(currentVersion);
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
        '',
        `🔍 ${network.toUpperCase()} Validator Version Check`,
        `Current epoch: ${currentEpoch.epoch}`,
        `Required ${isFiredancer ? 'Firedancer' : 'Agave'} version: ${
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

      await this.logger.info(report.join('\n'));
    }
  }

  async run() {
    await this.checkNetwork('mainnet');
    await this.checkNetwork('testnet');
  }
}

async function main() {
  const mainnetIdentity = process.env.MAINNET_IDENTITY;
  const testnetIdentity = process.env.TESTNET_IDENTITY;
  const onlyLogIssues = process.env.ONLY_LOG_VERSION_ISSUES === 'true';
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
