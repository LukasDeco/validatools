/**
 * Benchmark tool to measure slot processing latency of a non-voting hot spare validator
 * by comparing slot times between a local validator and mainnet RPC.
 *
 * This helps verify that a hot spare validator is keeping up with the network
 * by measuring the time between slot changes and comparing against mainnet.
 * A large latency differential could indicate the validator is falling behind.
 */

import { Connection, clusterApiUrl, Cluster } from "@solana/web3.js";

interface BenchmarkConfig {
  sampleCount: number;
  cluster: Cluster;
  rpcUrl?: string;
}

function getConfigFromEnv(): BenchmarkConfig {
  return {
    sampleCount: parseInt(process.env.SAMPLE_COUNT || "60", 10),
    cluster: (process.env.SOLANA_CLUSTER || "mainnet-beta") as Cluster,
    rpcUrl: process.env.RPC_URL,
  };
}

/**
 * Measures the average time between slot changes for a given connection
 * @param connection The Solana connection to measure
 * @param label Label to identify the connection in logs
 * @param sampleCount Number of samples to collect
 * @returns Promise that resolves to the average slot interval in milliseconds
 */
async function measureSlotLatency(
  connection: Connection,
  label: string,
  sampleCount: number
) {
  return new Promise<number>((resolve) => {
    const slotTimes: number[] = [];

    let lastTimestamp = Date.now();
    let count = 0;

    const id = connection.onSlotChange((slotInfo) => {
      const now = Date.now();
      const delta = now - lastTimestamp;
      lastTimestamp = now;

      if (count > 0) slotTimes.push(delta); // skip first as baseline
      count++;

      if (count >= sampleCount) {
        connection.removeSlotChangeListener(id);
        const avg = slotTimes.reduce((a, b) => a + b, 0) / slotTimes.length;
        console.log(`${label} average slot interval: ${avg.toFixed(2)} ms`);
        resolve(avg);
      }
    });
  });
}

async function main() {
  const config = getConfigFromEnv();

  const local = new Connection("http://127.0.0.1:8899");
  const rpc = new Connection(config.rpcUrl || clusterApiUrl(config.cluster));

  console.log(`Starting slot latency measurement...
Configuration:
- Sample Count: ${config.sampleCount}
- Cluster: ${config.cluster}
- RPC URL: ${config.rpcUrl || clusterApiUrl(config.cluster)}
`);

  const [localAvg, rpcAvg] = await Promise.all([
    measureSlotLatency(local, "Localhost", config.sampleCount),
    measureSlotLatency(rpc, `${config.cluster} RPC`, config.sampleCount),
  ]);

  const diff = localAvg - rpcAvg;
  console.log(`\nLatency Differential: ${diff.toFixed(2)} ms (Local - RPC)`);
}

main().catch(console.error);
