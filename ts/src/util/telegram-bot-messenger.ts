import axios from "axios";

export class TelegramBotMessenger {
  private botToken: string;
  private chatId: string;
  private apiUrl: string;

  constructor(botToken: string, chatId: string) {
    if (!botToken || !chatId) {
      throw new Error("Bot token and chat ID are required.");
    }

    this.botToken = botToken;
    this.chatId = chatId;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendMessage(message: string): Promise<void> {
    try {
      const url = `${this.apiUrl}/sendMessage`;
      await axios.post(url, {
        chat_id: this.chatId,
        text: message,
        parse_mode: "HTML", // Optional: can be "Markdown" or "HTML"
      });
    } catch (error) {
      console.error("Failed to send Telegram message:", error);
      throw error;
    }
  }
}
