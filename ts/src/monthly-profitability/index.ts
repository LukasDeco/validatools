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
  const voteAccount = new PublicKey(voteAccountAddress);
  const now = new Date();
  const startDate = getMostRecentBillingDate(monthlyBillingDay);
  const startDateStr = startDate.toISOString().split("T")[0];
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

  await logger.info(
    `Fetching vote rewards from epoch ${startEpoch} to ${endEpoch}`
  );

  const allEpochRewards: {
    epoch: number;
    reward: number;
    commission: number;
  }[] = [];

  for (let epoch = startEpoch; epoch <= endEpoch; epoch++) {
    try {
      const rewards = await connection.getInflationReward([voteAccount], epoch);
      if (rewards && rewards[0]) {
        allEpochRewards.push({
          epoch,
          reward: rewards[0].amount / LAMPORTS_PER_SOL,
          commission: rewards[0].commission || 0,
        });
      }
    } catch (e) {
      await logger.warn(`Error fetching rewards for epoch ${epoch}: ${e}`);
    }
  }

  const totalVoteRewards = allEpochRewards.reduce(
    (acc, r) => acc + r.reward,
    0
  );

  await logger.info("Fetching Jito MEV rewards...");
  const jitoData = (
    await axios.get(
      `https://kobe.mainnet.jito.network/api/v1/validators/${voteAccountAddress}`
    )
  ).data as Array<{
    epoch: number;
    mev_commission_bps: number;
    mev_rewards: number;
  }>;

  const relevantJitoRewards = jitoData.filter(
    (jr) => jr.epoch >= startEpoch && jr.epoch <= endEpoch
  );

  const totalJitoRewards = relevantJitoRewards.reduce((sum, jr) => {
    const effective = jr.mev_rewards * (jr.mev_commission_bps / 10000);
    return sum + effective / LAMPORTS_PER_SOL;
  }, 0);

  const totalGainSOL = totalVoteRewards + totalJitoRewards;

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
    `• Jito tips: ${totalJitoRewards.toFixed(2)} SOL`,
    ``,
    `SOL Price: $${solanaPrice}`,
    `Expenses: $${expensesUSD.toFixed(2)}`,
    `Elapsed: ${elapsedPct.toFixed(2)}%`,
    `Coverage: ${percentCovered.toFixed(2)}%`,
    trackingStatus,
    status,
  ].join("\n");

  await logger.info(summary);
}

main().catch((err) => logger.error(`Fatal error: ${err.stack || err}`));
