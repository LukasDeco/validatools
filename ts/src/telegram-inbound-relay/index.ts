/**
 * Long-polls Telegram getUpdates and forwards main-chat messages containing
 * "delinquent" (case-insensitive) to TELEGRAM_ALERT_CHAT_ID (e.g. agave-watchtower).
 * Run as a separate process alongside the central cron runner (no schedule).
 *
 * Two phases: (1) a short startup drain with timeout=0 to ack backlog without
 * forwarding; (2) steady-state long polling (timeout≈50s) so each HTTP call
 * blocks until Telegram has updates or the timeout elapses — not a tight loop,
 * and well within Bot API expectations.
 */

import { TelegramBotMessenger } from '../util/telegram-bot-messenger';

const DEFAULT_COOLDOWN_MS = 600_000; // 10 minutes

interface TgChat {
  id: number;
}

interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
  caption?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  edited_message?: TgMessage;
  edited_channel_post?: TgMessage;
}

function matchesDelinquentAlert(text: string): boolean {
  return text.toLowerCase().includes('delinquent');
}

function messageText(m: TgMessage): string {
  return (m.text ?? m.caption ?? '').trim();
}

function chatIdMatches(mainChatId: string, chatId: number): boolean {
  return String(chatId) === mainChatId.trim();
}

function extractMessage(update: TgUpdate): TgMessage | undefined {
  return (
    update.message ??
    update.channel_post ??
    update.edited_message ??
    update.edited_channel_post
  );
}

/**
 * Telegram holds the connection open for up to `timeoutSec` seconds (long poll).
 * Use timeout 0 for quick, non-blocking batches (e.g. startup drain only).
 */
async function getUpdates(
  botToken: string,
  offset: number,
  timeoutSec: number
): Promise<TgUpdate[]> {
  const params = new URLSearchParams({
    offset: String(offset),
    timeout: String(timeoutSec),
  });
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?${params}`;
  const res = await fetch(url);
  const body = (await res.json()) as {
    ok: boolean;
    result?: TgUpdate[];
    description?: string;
  };
  if (!res.ok || !body.ok) {
    throw new Error(
      `getUpdates failed: ${res.status} ${
        body.description ?? JSON.stringify(body)
      }`
    );
  }
  return body.result ?? [];
}

function parseCooldownMs(): number {
  const raw = process.env.TELEGRAM_ALERT_COOLDOWN_MS ?? '';
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_COOLDOWN_MS;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const mainChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const alertChatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim();

  if (!token || !mainChatId || !alertChatId) {
    console.error(
      'Missing env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and TELEGRAM_ALERT_CHAT_ID are required.'
    );
    process.exit(1);
  }

  const cooldownMs = parseCooldownMs();
  let lastForwardAt = 0;

  const messenger = new TelegramBotMessenger(token, mainChatId);

  console.log(
    `[telegram-inbound-relay] Listening for "delinquent" in chat ${mainChatId} → alert ${alertChatId} (cooldown ${cooldownMs} ms). Bot privacy must be off in @BotFather for group messages.`
  );

  // Startup only: drain Telegram's pending update queue with timeout=0 (fast
  // responses, up to 100 updates per call). Loop exits when the queue is empty
  // or the last batch is partial — finite work, not the steady-state poll.
  let offset = 0;
  while (true) {
    const batch = await getUpdates(token, offset, 0);
    if (batch.length === 0) break;
    for (const u of batch) {
      offset = Math.max(offset, u.update_id + 1);
    }
    if (batch.length < 100) break;
  }
  console.log(
    `[telegram-inbound-relay] Drained pending updates, starting long poll at offset ${offset}`
  );

  // Steady state: long poll. One request blocks up to ~50s; when idle you get
  // roughly one round-trip per timeout — not rapid-fire polling, so no API abuse.
  const timeoutSec = 50; // Telegram allows up to 50 for long poll

  for (;;) {
    try {
      const updates = await getUpdates(token, offset, timeoutSec);
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        const msg = extractMessage(u);
        if (!msg || !chatIdMatches(mainChatId, msg.chat.id)) continue;
        const text = messageText(msg);
        if (!text || !matchesDelinquentAlert(text)) continue;

        const now = Date.now();
        if (now - lastForwardAt < cooldownMs) {
          console.log(
            `[telegram-inbound-relay] Skipped forward (cooldown), update_id=${u.update_id}`
          );
          continue;
        }
        lastForwardAt = now;

        const forwardBody = `🚨 Watchtower:\n${text}`;
        await messenger.sendMessageToChat(alertChatId, forwardBody, false);
        console.log(
          `[telegram-inbound-relay] Forwarded update_id=${u.update_id} to alert chat`
        );
      }
    } catch (e) {
      console.error('[telegram-inbound-relay]', e);
      // Back off briefly on network/API errors before the next long poll.
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
