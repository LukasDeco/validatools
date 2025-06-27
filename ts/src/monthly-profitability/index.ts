import { Connection } from "@solana/web3.js";
import axios from "axios";
import { Logger } from "../util/logger"; // adjust path as needed

interface ValidatorRewards {
  totalVoteRewards: number;
  totalJitoRewards: number;
  totalBlockRewards: number;
  totalBlocksWithRewards: number;
  totalVoteCost: number;
}

interface ProfitabilityReport {
  startDate: Date;
  currentDate: Date;
  endDate: Date;
  solanaPrice: number;
  rewards: ValidatorRewards;
  expenses: {
    monthlyBaseUSD: number;
    monthlyTotalUSD: number;
    accruedTotalUSD: number;
    voteCostUSD: number;
    estimatedMonthlyVoteCostUSD: number;
  };
  revenue: {
    totalSOL: number;
    totalUSD: number;
    projectedUSD: number;
  };
  profit: {
    currentSOL: number;
    currentUSD: number;
    projectedUSD: number;
  };
  coverage: {
    elapsed: number;
    current: number;
    projected: number;
  };
}

export class RewardsService {
  constructor(
    private connection: Connection,
    private voteAccountAddress: string
  ) {}

  async fetchRewards(
    startEpoch: number,
    endEpoch: number
  ): Promise<ValidatorRewards> {
    let totalVoteRewards = 0;
    let totalJitoRewards = 0;
    let totalBlockRewards = 0;
    let totalBlocksWithRewards = 0;
    let totalVoteCost = 0;

    try {
      const trilliumValidatorData = await axios
        .get(
          `https://api.trillium.so/validator_rewards/${this.voteAccountAddress}`
        )
        .then((res) => res.data);

      // Process epochs if they fall within our range
      for (const epochData of trilliumValidatorData) {
        if (epochData.epoch >= startEpoch && epochData.epoch < endEpoch) {
          totalVoteRewards +=
            epochData.total_inflation_reward * (epochData.commission / 100);
          totalJitoRewards +=
            epochData.mev_earned * (epochData.mev_commission / 10_000);
          totalBlockRewards += epochData.rewards || 0;
          totalBlocksWithRewards += epochData.rewards > 0 ? 1 : 0;
          totalVoteCost += epochData.vote_cost || 0;
        }
      }

      const earliestEpochInAPI = Math.min(
        ...trilliumValidatorData.map((d) => d.epoch)
      );

      if (startEpoch < earliestEpochInAPI) {
        for (let epoch = startEpoch; epoch < earliestEpochInAPI; epoch++) {
          const trilliumData = await fetch(
            `https://api.trillium.so/validator_rewards/${epoch}`
          ).then((res) => res.json());

          const validatorData = trilliumData.find(
            (v: any) => v.vote_account_pubkey === this.voteAccountAddress
          );

          if (validatorData) {
            totalVoteRewards +=
              validatorData.total_inflation_reward *
                (validatorData.commission / 100) || 0;
            totalJitoRewards +=
              validatorData.mev_earned *
                (validatorData.mev_commission / 10_000) || 0;
            totalBlockRewards += validatorData.rewards || 0;
            totalVoteCost += validatorData.vote_cost || 0;
          }
        }
      }
    } catch (err) {
      // Fallback to epoch-by-epoch API
      for (let epoch = startEpoch; epoch < endEpoch; epoch++) {
        const trilliumData = await fetch(
          `https://api.trillium.so/validator_rewards/${epoch}`
        ).then((res) => res.json());

        const validatorData = trilliumData.find(
          (v: any) => v.vote_account_pubkey === this.voteAccountAddress
        );

        if (validatorData) {
          totalVoteRewards +=
            validatorData.total_inflation_reward *
              (validatorData.commission / 100) || 0;
          totalJitoRewards +=
            validatorData.mev_earned *
              (validatorData.mev_commission / 10_000) || 0;
          totalBlockRewards += validatorData.rewards || 0;
          totalVoteCost += validatorData.vote_cost || 0;
        }
      }
    }

    return {
      totalVoteRewards,
      totalJitoRewards,
      totalBlockRewards,
      totalBlocksWithRewards,
      totalVoteCost,
    };
  }
}

export class ProfitabilityReportService {
  constructor(
    private monthlyExpenses: number,
    private voteCostReimbursement: number = 0
  ) {}

  async generateReport(
    startDate: Date,
    currentDate: Date,
    endDate: Date,
    rewards: ValidatorRewards
  ): Promise<string> {
    const solanaPrice = (
      await axios.get(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
      )
    ).data.solana.usd;

    const reimbursedVoteCost =
      rewards.totalVoteCost * (1 - this.voteCostReimbursement / 100);

    // Calculate net SOL gained (revenue - vote costs)
    const totalRevenueSOL =
      rewards.totalVoteRewards +
      rewards.totalJitoRewards +
      rewards.totalBlockRewards;
    const netGainSOL = totalRevenueSOL - reimbursedVoteCost;

    // Calculate elapsed time percentages
    const elapsedMs = currentDate.getTime() - startDate.getTime();
    const totalCycleMs = endDate.getTime() - startDate.getTime();
    const elapsedPct = (elapsedMs / totalCycleMs) * 100;

    // Project monthly SOL earnings based on current rate
    const projectedMonthlySOL = (netGainSOL / elapsedMs) * totalCycleMs;
    const projectedMonthlyUSD = projectedMonthlySOL * solanaPrice;

    // Calculate projected monthly profit
    const projectedProfitUSD = projectedMonthlyUSD - this.monthlyExpenses;
    const percentCovered = (projectedMonthlyUSD / this.monthlyExpenses) * 100;

    // Current period actuals
    const currentNetGainUSD = netGainSOL * solanaPrice;
    const accruedExpensesUSD =
      (this.monthlyExpenses * elapsedMs) / totalCycleMs;
    const currentProfitUSD = currentNetGainUSD - accruedExpensesUSD;
    const currentPercentCovered =
      (currentNetGainUSD / accruedExpensesUSD) * 100;

    const onTrackOutcome =
      projectedMonthlyUSD > this.monthlyExpenses ? "make profit" : "break even";
    const trackingStatus =
      projectedMonthlyUSD >= this.monthlyExpenses
        ? `✅ On track to ${onTrackOutcome} (projected: ${percentCovered.toFixed(
            1
          )}%)`
        : `⚠️ Behind pace (projected: ${percentCovered.toFixed(1)}%)`;

    const status =
      currentPercentCovered >= 100
        ? "✅ You've covered your accrued expenses!"
        : `🟡 You've covered ${currentPercentCovered.toFixed(
            2
          )}% of accrued expenses.`;

    return [
      `🧾 Validator Profit Report`,
      `SOL Price: $${solanaPrice}`,
      `Period: ${startDate.toISOString().split("T")[0]} → ${
        currentDate.toISOString().split("T")[0]
      }`,
      "",
      "---Revenues---",
      `Revenue: ${totalRevenueSOL.toFixed(2)} SOL ($${(
        totalRevenueSOL * solanaPrice
      ).toFixed(2)})`,
      `• Vote rewards: ${rewards.totalVoteRewards.toFixed(2)} SOL`,
      `• Block rewards: ${rewards.totalBlockRewards.toFixed(2)} SOL`,
      `• Jito tips: ${rewards.totalJitoRewards.toFixed(2)} SOL`,
      "",
      "---Expenses---",
      `• Vote costs: ${reimbursedVoteCost.toFixed(2)} SOL${
        this.voteCostReimbursement > 0
          ? ` (${this.voteCostReimbursement}% reimbursed)`
          : ""
      }`,
      `• Monthly Base Expenses: $${this.monthlyExpenses.toFixed(2)}`,
      `• Accrued Base Expenses: $${accruedExpensesUSD.toFixed(2)}`,
      "",
      "Summary:",
      `• Net SOL Gained: ${netGainSOL.toFixed(
        2
      )} SOL ($${currentNetGainUSD.toFixed(2)})`,
      `• Current Period Profit: $${currentProfitUSD.toFixed(2)}`,
      `• Elapsed: ${elapsedPct.toFixed(2)}%`,
      `• Current Coverage: ${currentPercentCovered.toFixed(2)}%`,
      `• Projected Monthly Net: ${projectedMonthlySOL.toFixed(
        2
      )} SOL ($${projectedMonthlyUSD.toFixed(2)})`,
      `• Projected Monthly Profit: $${projectedProfitUSD.toFixed(2)}`,
      trackingStatus,
      status,
    ].join("\n");
  }
}

// TODO: does math make sense? It should just be monthly base expenses - SOL projected to be gained * price(just SOL rev - vote costs)
export class MonthlyProfitabilityBot {
  private logger: Logger;
  private rewardsService: RewardsService;
  private profitabilityReportService: ProfitabilityReportService;

  constructor(
    private voteAccountAddress: string,
    private identityAddress: string,
    private monthlyExpenses: string,
    private monthlyBillingDay: number,
    private voteCostReimbursement: number = 0
  ) {
    this.logger = new Logger({
      telegramEnabled: process.env.TELEGRAM_ENABLED === "true",
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      prefix: "[ValidatorTracker] ",
    });

    const connection = new Connection(
      process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
      "confirmed"
    );

    this.rewardsService = new RewardsService(connection, voteAccountAddress);
    this.profitabilityReportService = new ProfitabilityReportService(
      parseFloat(monthlyExpenses),
      voteCostReimbursement
    );
  }

  getMostRecentBillingDate(targetDay: number): Date {
    const today = new Date();
    const currentDay = today.getDate();
    const month =
      currentDay >= targetDay ? today.getMonth() : today.getMonth() - 1;
    const year = month < 0 ? today.getFullYear() - 1 : today.getFullYear();
    return new Date(year, (month + 12) % 12, targetDay);
  }

  async run() {
    if (
      !this.voteAccountAddress ||
      !this.identityAddress ||
      !this.monthlyExpenses
    ) {
      await this.logger.error(`Missing env vars:
        - VOTE_ACCOUNT
        - IDENTITY
        - MONTHLY_EXPENSES
        - (Optional) MONTHLY_BILLING_DAY
        - (Optional) VOTE_COST_REIMBURSEMENT`);
      process.exit(1);
    }

    if (this.monthlyBillingDay < 1 || this.monthlyBillingDay > 31) {
      await this.logger.error("Invalid MONTHLY_BILLING_DAY provided.");
      process.exit(1);
    }

    if (this.voteCostReimbursement < 0 || this.voteCostReimbursement > 100) {
      await this.logger.error(
        "Invalid VOTE_COST_REIMBURSEMENT provided. Must be between 0 and 100."
      );
      process.exit(1);
    }

    const now = new Date();
    const startDate = this.getMostRecentBillingDate(this.monthlyBillingDay);
    const nextBillingDate = new Date(startDate);
    nextBillingDate.setMonth(startDate.getMonth() + 1);

    const connection = new Connection(
      process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
      "confirmed"
    );

    const currentEpoch = (await connection.getEpochInfo()).epoch;
    const epochSchedule = await connection.getEpochSchedule();
    const recentSlot = await connection.getSlot();
    const recentTimestamp =
      (await connection.getBlockTime(recentSlot)) ||
      Math.floor(Date.now() / 1000);
    const secondsDifference = startDate.getTime() / 1000 - recentTimestamp;
    let startSlot = recentSlot + Math.floor(secondsDifference / 0.4);
    if (startSlot < 0) startSlot = 0;

    const startEpoch = Math.max(
      0,
      epochSchedule.getEpochAndSlotIndex(startSlot)[0]
    );
    const endEpoch = currentEpoch - 1;

    await this.logger.info(
      `Fetching validator rewards from epoch ${startEpoch} to ${endEpoch}`
    );

    const rewards = await this.rewardsService.fetchRewards(
      startEpoch,
      endEpoch
    );
    const report = await this.profitabilityReportService.generateReport(
      startDate,
      now,
      nextBillingDate,
      rewards
    );

    await this.logger.info(report);
  }
}

async function main() {
  const voteAccountAddress: string = process.env.VOTE_ACCOUNT!;
  const identityAddress: string = process.env.IDENTITY!;
  const monthlyExpenses: string = process.env.MONTHLY_EXPENSES!;
  const monthlyBillingDay: number = parseInt(
    process.env.MONTHLY_BILLING_DAY || "1"
  );
  const voteCostReimbursement: number = parseFloat(
    process.env.VOTE_COST_REIMBURSEMENT || "0"
  );

  const bot = new MonthlyProfitabilityBot(
    voteAccountAddress,
    identityAddress,
    monthlyExpenses,
    monthlyBillingDay,
    voteCostReimbursement
  );
  await bot.run();
}

// main().catch((err) => console.error(`Fatal error: ${err.stack || err}`)); // uncomment to run directly
