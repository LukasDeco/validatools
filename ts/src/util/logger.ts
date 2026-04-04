import { TelegramBotMessenger } from "./telegram-bot-messenger";

type LogLevel = "info" | "warn" | "error";

const DEFAULT_ALERT_COOLDOWN_MS = 600_000; // 10 minutes

/** True if the log line should also go to TELEGRAM_ALERT_CHAT_ID. */
export function messageMatchesCriticalKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("delinquent")) return true;
  if (text.toUpperCase().includes("CRITICAL")) return true;
  return false;
}

interface LoggerOptions {
  telegramEnabled?: boolean;
  botToken?: string;
  chatId?: string;
  /** High-priority Telegram group; defaults to TELEGRAM_ALERT_CHAT_ID env. */
  alertChatId?: string;
  /** Min ms between critical duplicate sends; defaults to TELEGRAM_ALERT_COOLDOWN_MS or 600000. */
  alertCooldownMs?: number;
  prefix?: string;
}

export class Logger {
  private telegram?: TelegramBotMessenger;
  private telegramEnabled: boolean;
  private prefix: string;
  private alertChatId?: string;
  private alertCooldownMs: number;
  private lastCriticalAlertAt = 0;

  constructor(options: LoggerOptions = {}) {
    this.telegramEnabled = options.telegramEnabled ?? false;
    this.prefix = options.prefix ?? "";

    const envCooldown = parseInt(
      process.env.TELEGRAM_ALERT_COOLDOWN_MS || "",
      10
    );
    this.alertCooldownMs =
      options.alertCooldownMs ??
      (Number.isFinite(envCooldown) && envCooldown >= 0
        ? envCooldown
        : DEFAULT_ALERT_COOLDOWN_MS);

    const alertFromEnv =
      (options.alertChatId ?? process.env.TELEGRAM_ALERT_CHAT_ID ?? "").trim();
    this.alertChatId = alertFromEnv || undefined;

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
    if (!this.telegramEnabled || !this.telegram) {
      return;
    }

    try {
      await this.telegram.sendMessage(formattedMessage);
    } catch (err) {
      console.error("Failed to send log to Telegram:", err);
    }

    if (
      this.alertChatId &&
      messageMatchesCriticalKeywords(formattedMessage)
    ) {
      const now = Date.now();
      if (now - this.lastCriticalAlertAt < this.alertCooldownMs) {
        return;
      }
      this.lastCriticalAlertAt = now;
      try {
        await this.telegram.sendMessageToChat(
          this.alertChatId,
          `🚨 ${formattedMessage}`
        );
      } catch (err) {
        console.error("Failed to send critical Telegram alert:", err);
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
