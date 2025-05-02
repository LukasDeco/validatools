import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import axios from "axios";

// Get required env variables
const voteAccountAddress = process.env.VOTE_ACCOUNT;
const identityAddress = process.env.IDENTITY;
const monthlyExpenses = process.env.MONTHLY_EXPENSES;

// Validate required env variables
if (!voteAccountAddress || !identityAddress || !monthlyExpenses) {
  console.error("Missing required environment variables:");
  console.error("VOTE_ACCOUNT - Vote account address");
  console.error("IDENTITY - Identity account address");
  console.error("START_DATE - Billing start date (YYYY-MM-DD)");
  console.error("MONTHLY_EXPENSES - Monthly expenses in USD");
  process.exit(1);
}

const monthlyBillingDay = parseInt(process.env.MONTHLY_BILLING_DAY || "1");
if (monthlyBillingDay < 1 || monthlyBillingDay > 31) {
  console.error("Invalid MONTHLY_BILLING_DAY provided.");
  process.exit(1);
}

// Get the most recent billing date
function getMostRecentBillingDate(targetDay: number): Date {
  const today = new Date();
  const currentDay = today.getDate();
  const month =
    currentDay >= targetDay ? today.getMonth() : today.getMonth() - 1;
  const year = month < 0 ? today.getFullYear() - 1 : today.getFullYear();
  const adjustedMonth = (month + 12) % 12;

  const billingDate = new Date(year, adjustedMonth, targetDay);
  return billingDate;
}

async function main() {
  const connection = new Connection(
    process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );

  const voteAccount = new PublicKey(voteAccountAddress);

  const now = new Date();
  const startDate = getMostRecentBillingDate(monthlyBillingDay);
  const startDateStr = startDate.toISOString().split("T")[0];
  const currentEpochInfo = await connection.getEpochInfo();
  const currentEpoch = currentEpochInfo.epoch;

  const epochSchedule = await connection.getEpochSchedule();
  const recentSlot = await connection.getSlot();
  const recentTimestamp =
    (await connection.getBlockTime(recentSlot)) ||
    Math.floor(Date.now() / 1000);

  const secondsPerSlot = 0.4;
  const secondsDifference = startDate.getTime() / 1000 - recentTimestamp;
  let startSlot = recentSlot + Math.floor(secondsDifference / secondsPerSlot);
  if (startSlot < 0) startSlot = 0;

  const startEpoch = Math.max(
    0,
    epochSchedule.getEpochAndSlotIndex(startSlot)[0]
  );
  const endEpoch = currentEpoch - 1;
  console.log(`Fetching rewards from epoch ${startEpoch} to ${endEpoch}`);

  let allEpochRewards: Array<{
    epoch: number;
    reward: number;
    commission: number;
  }> = [];

  for (let epoch = startEpoch; epoch <= endEpoch; epoch++) {
    try {
      const epochRewards = await connection.getInflationReward(
        [voteAccount],
        epoch
      );

      if (epochRewards && epochRewards[0]) {
        allEpochRewards.push({
          epoch,
          reward: epochRewards[0].amount / LAMPORTS_PER_SOL,
          commission: epochRewards[0].commission || 0,
        });
      }
    } catch (e) {
      console.error("Error fetching rewards for epoch", epoch, e);
    }
  }

  let totalVoteRewards = 0;
  allEpochRewards.forEach((epochReward) => {
    totalVoteRewards += epochReward.reward;
  });

  // New: Fetch Jito rewards from API
  console.log(`\nFetching Jito MEV rewards from Jito API...`);
  const jitoApiUrl = `https://kobe.mainnet.jito.network/api/v1/validators/${voteAccountAddress}`;

  const jitoResponse = await axios.get(jitoApiUrl);
  const jitoData = jitoResponse.data as Array<{
    epoch: number;
    mev_commission_bps: number;
    mev_rewards: number;
  }>;

  // console.log("jitoData", jitoData);

  // Filter only the epochs we are interested in (after startEpoch)
  const relevantJitoRewards = jitoData.filter(
    (jr) => jr.epoch >= startEpoch && jr.epoch <= endEpoch
  );

  // console.log("relevantJitoRewards", relevantJitoRewards);

  let totalJitoRewards = 0;
  relevantJitoRewards.forEach((jr) => {
    const effectiveRewardLamports =
      jr.mev_rewards * (jr.mev_commission_bps / 10000); // Commission share
    totalJitoRewards += effectiveRewardLamports / LAMPORTS_PER_SOL;
  });

  const totalGainSOL = totalVoteRewards + totalJitoRewards;

  const solanaPrice = (
    await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    )
  ).data.solana.usd;

  const revenueUSD = totalGainSOL * solanaPrice;
  const expensesUSD = parseFloat(monthlyExpenses);

  // Print results
  console.log("\nValidator Profit Report");
  console.log("=====================");
  console.log(
    `Period: ${startDateStr} to ${new Date().toISOString().split("T")[0]}`
  );
  console.log(
    `Total SOL gained: ${totalGainSOL.toFixed(2)} SOL ($${(
      totalGainSOL * solanaPrice
    ).toFixed(2)})`
  );
  console.log(
    `Vote account rewards: ${totalVoteRewards.toFixed(2)} SOL ($${(
      totalVoteRewards * solanaPrice
    ).toFixed(2)})`
  );
  console.log(
    `Jito MEV tips: ${totalJitoRewards.toFixed(2)} SOL ($${(
      totalJitoRewards * solanaPrice
    ).toFixed(2)})`
  );

  const nextBillingDate = new Date(startDate);
  nextBillingDate.setMonth(startDate.getMonth() + 1);

  const totalCycleMs = nextBillingDate.getTime() - startDate.getTime();
  const elapsedMs = now.getTime() - startDate.getTime();
  const elapsedPercentage = (elapsedMs / totalCycleMs) * 100;

  const projectedRevenueUSD = (revenueUSD / elapsedMs) * totalCycleMs;
  const projectedProfitUSD = projectedRevenueUSD - expensesUSD;
  const projectedPercentCovered = (projectedRevenueUSD / expensesUSD) * 100;

  const trackingStatus =
    projectedRevenueUSD >= expensesUSD
      ? `✅ On track to break even (projected coverage: ${projectedPercentCovered.toFixed(
          1
        )}%)`
      : `⚠️ Behind pace (projected coverage: ${projectedPercentCovered.toFixed(
          1
        )}%)`;

  const percentCovered = (revenueUSD / expensesUSD) * 100;
  const status =
    percentCovered >= 100
      ? "✅ You've covered your monthly expenses!"
      : `🟡 You've covered ${percentCovered.toFixed(2)}% of your expenses.`;

  console.log(`Current SOL price: $${solanaPrice}`);
  console.log(`\nSince ${startDate.toISOString().split("T")[0]}:`);
  console.log(`- Revenue: $${revenueUSD.toFixed(2)}`);
  console.log(`- Expenses: $${expensesUSD.toFixed(2)}`);
  console.log(`- Coverage so far: ${percentCovered.toFixed(2)}%`);
  console.log(`- Month elapsed: ${elapsedPercentage.toFixed(2)}%`);
  console.log(`- ${trackingStatus}`);
  console.log(`- ${status}`);

  console.log(`\nRewards by epoch:`);
  allEpochRewards.forEach((er) => {
    console.log(
      `Epoch ${er.epoch}: ${er.reward.toFixed(4)} SOL (Commission: ${
        er.commission
      }%)`
    );
  });

  console.log(`\nJito rewards by epoch:`);
  relevantJitoRewards.forEach((jr) => {
    const effectiveReward =
      (jr.mev_rewards * (jr.mev_commission_bps / 10000)) / LAMPORTS_PER_SOL;
    console.log(
      `Epoch ${jr.epoch}: ${effectiveReward.toFixed(4)} SOL (Commission bps: ${
        jr.mev_commission_bps
      })`
    );
  });
}

main().catch(console.error);
