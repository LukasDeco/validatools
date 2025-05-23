import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import axios from "axios";
import { Logger } from "../util/logger"; // adjust path as needed

const voteAccountAddress = process.env.VOTE_ACCOUNT!;
const identityAddress = process.env.IDENTITY!;
const monthlyExpenses = process.env.MONTHLY_EXPENSES!;
const monthlyBillingDay = parseInt(process.env.MONTHLY_BILLING_DAY || "1");

const logger = new Logger({
  telegramEnabled: process.env.TELEGRAM_ENABLED === "true",
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  prefix: "[ValidatorTracker] ",
});

function getMostRecentBillingDate(targetDay: number): Date {
  const today = new Date();
  const currentDay = today.getDate();
  const month =
    currentDay >= targetDay ? today.getMonth() : today.getMonth() - 1;
  const year = month < 0 ? today.getFullYear() - 1 : today.getFullYear();
  return new Date(year, (month + 12) % 12, targetDay);
}

async function main() {
  if (!voteAccountAddress || !identityAddress || !monthlyExpenses) {
    await logger.error(`Missing env vars:
  - VOTE_ACCOUNT
  - IDENTITY
  - MONTHLY_EXPENSES
  - (Optional) MONTHLY_BILLING_DAY`);
    process.exit(1);
  }

  if (monthlyBillingDay < 1 || monthlyBillingDay > 31) {
    await logger.error("Invalid MONTHLY_BILLING_DAY provided.");
    process.exit(1);
  }

  const connection = new Connection(
    process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );

  const now = new Date();
  const startDate = getMostRecentBillingDate(monthlyBillingDay);
  const startDateStr = startDate.toISOString().split("T")[0];
  const currentEpoch = (await connection.getEpochInfo()).epoch;

  // Get start epoch by fetching epoch schedule and calculating epoch at start date
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

  let totalVoteRewards = 0;
  let totalJitoRewards = 0;
  let totalBlockRewards = 0;

  await logger.info(
    `Fetching validator rewards from epoch ${startEpoch} to ${endEpoch}`
  );

  // First try to get recent epochs from Trillium validator API
  try {
    const trilliumValidatorData = await axios
      .get(`https://api.trillium.so/validator_rewards/${voteAccountAddress}`)
      .then((res) => res.data);

    // Process last 10 epochs if they fall within our range
    for (const epochData of trilliumValidatorData) {
      if (epochData.epoch >= startEpoch && epochData.epoch < endEpoch) {
        totalVoteRewards +=
          epochData.total_inflation_reward * (epochData.commission / 100);
        totalJitoRewards +=
          epochData.mev_earned * (epochData.mev_commission / 10_000);
        totalBlockRewards += epochData.rewards || 0;
      }
    }

    // Get earliest epoch from validator API response
    const earliestEpochInAPI = Math.min(
      ...trilliumValidatorData.map((d) => d.epoch)
    );

    // Fetch any missing earlier epochs from epoch-specific API
    if (startEpoch < earliestEpochInAPI) {
      for (let epoch = startEpoch; epoch < earliestEpochInAPI; epoch++) {
        const trilliumData = await fetch(
          `https://api.trillium.so/validator_rewards/${epoch}`
        ).then((res) => res.json());

        const validatorData = trilliumData.find(
          (v: any) => v.vote_account_pubkey === voteAccountAddress
        );

        if (validatorData) {
          totalVoteRewards +=
            validatorData.total_inflation_reward *
              (validatorData.commission / 100) || 0;
          totalJitoRewards +=
            validatorData.mev_earned *
              (validatorData.mev_commission / 10_000) || 0;
          totalBlockRewards += validatorData.rewards || 0;
        }
      }
    }
  } catch (err) {
    // Fallback to epoch-by-epoch API if validator API fails
    for (let epoch = startEpoch; epoch < endEpoch; epoch++) {
      const trilliumData = await fetch(
        `https://api.trillium.so/validator_rewards/${epoch}`
      ).then((res) => res.json());

      const validatorData = trilliumData.find(
        (v: any) => v.vote_account_pubkey === voteAccountAddress
      );

      if (validatorData) {
        totalVoteRewards +=
          validatorData.total_inflation_reward *
            (validatorData.commission / 100) || 0;
        totalJitoRewards +=
          validatorData.mev_earned * (validatorData.mev_commission / 10_000) ||
          0;
        totalBlockRewards += validatorData.rewards || 0;
      }
    }
  }

  const totalGainSOL = totalVoteRewards + totalJitoRewards + totalBlockRewards;

  const solanaPrice = (
    await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    )
  ).data.solana.usd;

  const revenueUSD = totalGainSOL * solanaPrice;
  const expensesUSD = parseFloat(monthlyExpenses);

  const nextBillingDate = new Date(startDate);
  nextBillingDate.setMonth(startDate.getMonth() + 1);

  const elapsedMs = now.getTime() - startDate.getTime();
  const totalCycleMs = nextBillingDate.getTime() - startDate.getTime();
  const elapsedPct = (elapsedMs / totalCycleMs) * 100;

  const projectedRevenueUSD = (revenueUSD / elapsedMs) * totalCycleMs;
  const projectedProfitUSD = projectedRevenueUSD - expensesUSD;
  const projectedPercentCovered = (projectedRevenueUSD / expensesUSD) * 100;
  const percentCovered = (revenueUSD / expensesUSD) * 100;

  const trackingStatus =
    projectedRevenueUSD >= expensesUSD
      ? `✅ On track to break even (projected: ${projectedPercentCovered.toFixed(
          1
        )}%)`
      : `⚠️ Behind pace (projected: ${projectedPercentCovered.toFixed(1)}%)`;

  const status =
    percentCovered >= 100
      ? "✅ You've covered your monthly expenses!"
      : `🟡 You've covered ${percentCovered.toFixed(2)}% of expenses.`;

  const summary = [
    `🧾 Validator Profit Report`,
    `Period: ${startDateStr} → ${new Date().toISOString().split("T")[0]}`,
    `SOL Gained: ${totalGainSOL.toFixed(2)} SOL ($${revenueUSD.toFixed(2)})`,
    `• Vote rewards: ${totalVoteRewards.toFixed(2)} SOL`,
    `• Block rewards: ${totalBlockRewards.toFixed(2)} SOL`,
    `• Jito tips: ${totalJitoRewards.toFixed(2)} SOL`,
    ``,
    `SOL Price: $${solanaPrice}`,
    `Expenses: $${expensesUSD.toFixed(2)}`,
    `Elapsed: ${elapsedPct.toFixed(2)}%`,
    `Coverage: ${percentCovered.toFixed(2)}%`,
    `Projected Monthly Profit: $${projectedProfitUSD.toFixed(2)}`,
    trackingStatus,
    status,
  ].join("\n");

  await logger.info(summary);
}

main().catch((err) => logger.error(`Fatal error: ${err.stack || err}`));
