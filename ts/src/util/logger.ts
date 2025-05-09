import { TelegramBotMessenger } from "./telegram-bot-messenger";

type LogLevel = "info" | "warn" | "error";

interface LoggerOptions {
  telegramEnabled?: boolean;
  botToken?: string;
  chatId?: string;
  prefix?: string;
}

export class Logger {
  private telegram?: TelegramBotMessenger;
  private telegramEnabled: boolean;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.telegramEnabled = options.telegramEnabled ?? false;
    this.prefix = options.prefix ?? "";

    if (this.telegramEnabled && options.botToken && options.chatId) {
      this.telegram = new TelegramBotMessenger(
        options.botToken,
        options.chatId
      );
    }
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${this.prefix}${message}`;
  }

  private async maybeSendToTelegram(formattedMessage: string) {
    if (this.telegramEnabled && this.telegram) {
      try {
        await this.telegram.sendMessage(formattedMessage);
      } catch (err) {
        console.error("Failed to send log to Telegram:", err);
      }
    }
  }

  async info(message: string) {
    const formatted = this.format("info", message);
    console.log(formatted);
    await this.maybeSendToTelegram(formatted);
  }

  async warn(message: string) {
    const formatted = this.format("warn", message);
    console.warn(formatted);
    await this.maybeSendToTelegram(formatted);
  }

  async error(message: string) {
    const formatted = this.format("error", message);
    console.error(formatted);
    await this.maybeSendToTelegram(formatted);
  }
}
