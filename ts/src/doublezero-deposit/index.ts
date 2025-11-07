import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Logger } from "../util/logger";

export class DoublezeroDepositBot {
  constructor(
    private nodeId: string,
    private thresholdSol: number,
    private programId?: string
  ) {}

  async run() {
    const logger = new Logger({
      telegramEnabled: process.env.TELEGRAM_ENABLED === "true",
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      prefix: "[DZDeposit] ",
    });

    if (
      !this.nodeId ||
      this.thresholdSol === undefined ||
      this.thresholdSol === null
    ) {
      await logger.error(
        "Missing required configuration: nodeId and thresholdSol are required."
      );
      return;
    }

    const connection = new Connection(
      process.env.MAINNET_RPC_URL ||
        process.env.RPC_URL ||
        "https://api.mainnet-beta.solana.com",
      "confirmed"
    );

    const programPk = new PublicKey(
      this.programId || "dzrevZC94tBLwuHw1dyynZxaXTWyp7yocsinyEVPtt4"
    );

    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("solana_validator_deposit"),
        new PublicKey(this.nodeId).toBuffer(),
      ],
      programPk
    );

    const lamports = await connection.getBalance(pda);
    const thresholdLamports = Math.floor(this.thresholdSol * LAMPORTS_PER_SOL);

    if (lamports < thresholdLamports) {
      await logger.warn(
        `Deposit low: ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL below ${
          this.thresholdSol
        } (PDA: ${pda.toBase58()})`
      );
      // await logger.warn(`Deposit low`);
    } else {
      await logger.info(
        `Deposit OK: ${(lamports / LAMPORTS_PER_SOL).toFixed(
          6
        )} SOL (PDA: ${pda.toBase58()})`
      );
    }
  }
}
