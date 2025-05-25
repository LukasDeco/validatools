import * as yaml from "js-yaml";
import * as fs from "fs";
import * as cron from "node-cron";
import { MonthlyProfitabilityBot } from "./monthly-profitability";
import { SFDPComplianceBot } from "./check-sfdp-compliance";

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
  // Load config
  const config = yaml.load(
    fs.readFileSync("./ts/src/config.yaml", "utf8")
  ) as Config;

  console.log(config);

  // Set up monthly profitability bot if enabled
  if (config.monthlyProfitability?.enabled) {
    const voteAccountAddress =
      config.monthlyProfitability?.config?.voteAccount || "";
    const identityAddress = config.monthlyProfitability?.config?.identity || "";
    const monthlyExpenses =
      config.monthlyProfitability?.config?.monthlyExpenses || "";
    const monthlyBillingDay =
      config.monthlyProfitability?.config?.monthlyBillingDay || 1;

    const profitabilityBot = new MonthlyProfitabilityBot(
      voteAccountAddress,
      identityAddress,
      monthlyExpenses,
      monthlyBillingDay
    );

    cron.schedule(config.monthlyProfitability.schedule, async () => {
      try {
        await profitabilityBot.run();
      } catch (err) {
        console.error(
          `Error running monthly profitability bot: ${err.stack || err}`
        );
      }
    });
  }

  // Set up SFDP compliance checker if enabled
  if (config.sfdpCompliance?.enabled) {
    const sfdpChecker = new SFDPComplianceBot(
      config.sfdpCompliance?.config?.mainnetIdentity || "",
      config.sfdpCompliance?.config?.testnetIdentity || ""
    );

    cron.schedule(config.sfdpCompliance.schedule, async () => {
      try {
        await sfdpChecker.run();
      } catch (err) {
        console.error(
          `Error running SFDP compliance checker: ${err.stack || err}`
        );
      }
    });
  }

  console.log("Validator tools started successfully");
}

main().catch((err) => console.error(`Fatal error: ${err.stack || err}`));
