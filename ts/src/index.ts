import * as yaml from "js-yaml";
import * as fs from "fs";
import * as cron from "node-cron";
import { MonthlyProfitabilityBot } from "./monthly-profitability";
import { SFDPComplianceBot } from "./check-sfdp-compliance";
import yargs from "yargs";

interface ToolConfig {
  enabled: boolean;
  schedule: string;
  config?: Record<string, any>;
}

interface Config {
  monthlyProfitability?: ToolConfig;
  stakePoolOpportunities?: ToolConfig;
  sfdpCompliance?: ToolConfig;
}

async function main() {
  // Parse CLI arguments
  const argv = yargs(process.argv.slice(2))
    .option("config", {
      type: "string",
      description: "Path to config file",
      default: "./ts/src/config.yaml",
    })
    // Monthly profitability args
    .option("monthly-vote-account", {
      type: "string",
      description: "Vote account address for monthly profitability",
    })
    .option("monthly-identity", {
      type: "string",
      description: "Identity address for monthly profitability",
    })
    .option("monthly-expenses", {
      type: "number",
      description: "Monthly expenses amount",
    })
    .option("monthly-billing-day", {
      type: "number",
      description: "Monthly billing day",
      default: 1,
    })
    .option("vote-cost-reimbursement", {
      type: "number",
      description: "Vote cost reimbursement amount",
      default: 0,
    })
    // SFDP compliance args
    .option("sfdp-mainnet-identity", {
      type: "string",
      description: "Mainnet identity for SFDP compliance",
    })
    .option("sfdp-testnet-identity", {
      type: "string",
      description: "Testnet identity for SFDP compliance",
    })
    .option("sfdp-only-log-issues", {
      type: "boolean",
      description: "Only log SFDP compliance issues",
      default: false,
    })
    .option("sfdp-mainnet-version", {
      type: "string",
      description: "Override mainnet version for SFDP compliance",
    })
    .option("sfdp-testnet-version", {
      type: "string",
      description: "Override testnet version for SFDP compliance",
    })
    .help().argv;

  // Load config
  const config = yaml.load(
    fs.readFileSync(argv.config as string, "utf8")
  ) as Config;

  console.log(config);

  // Set up monthly profitability bot if enabled
  if (config.monthlyProfitability?.enabled) {
    const voteAccountAddress =
      argv["monthly-vote-account"] ||
      config.monthlyProfitability?.config?.voteAccount ||
      "";
    const identityAddress =
      argv["monthly-identity"] ||
      config.monthlyProfitability?.config?.identity ||
      "";
    const monthlyExpenses =
      argv["monthly-expenses"] ||
      config.monthlyProfitability?.config?.monthlyExpenses ||
      "";
    const monthlyBillingDay =
      argv["monthly-billing-day"] ||
      config.monthlyProfitability?.config?.monthlyBillingDay ||
      1;
    const voteCostReimbursement =
      argv["vote-cost-reimbursement"] ||
      config.monthlyProfitability?.config?.voteCostReimbursement ||
      0;

    const profitabilityBot = new MonthlyProfitabilityBot(
      voteAccountAddress,
      identityAddress,
      monthlyExpenses,
      monthlyBillingDay,
      voteCostReimbursement
    );

    await profitabilityBot.run();
    if (config.monthlyProfitability.schedule) {
      cron.schedule(config.monthlyProfitability.schedule, async () => {
        try {
          console.log("Running monthly profitability bot");
          await profitabilityBot.run();
        } catch (err) {
          console.error(
            `Error running monthly profitability bot: ${err.stack || err}`
          );
        }
      });
    }
  }

  // Set up SFDP compliance checker if enabled
  if (config.sfdpCompliance?.enabled) {
    const sfdpChecker = new SFDPComplianceBot(
      argv["sfdp-mainnet-identity"] ||
        config.sfdpCompliance?.config?.mainnetIdentity ||
        "",
      argv["sfdp-testnet-identity"] ||
        config.sfdpCompliance?.config?.testnetIdentity ||
        "",
      argv["sfdp-only-log-issues"] ||
        config.sfdpCompliance?.config?.onlyLogIssues ||
        false,
      argv["sfdp-mainnet-version"],
      argv["sfdp-testnet-version"]
    );

    await sfdpChecker.run();
    if (config.sfdpCompliance.schedule) {
      cron.schedule(config.sfdpCompliance.schedule, async () => {
        try {
          console.log("Running SFDP compliance checker");
          await sfdpChecker.run();
        } catch (err) {
          console.error(
            `Error running SFDP compliance checker: ${err.stack || err}`
          );
        }
      });
    }
  }

  console.log("Validator tools started successfully");
}

main().catch((err) => console.error(`Fatal error: ${err.stack || err}`));
