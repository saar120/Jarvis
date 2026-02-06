import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { runMainAgent, isCliError } from "./cli-runner.js";
import { getSessionId, setSessionId, resetSession } from "./session-store.js";
import { startLogWriter } from "./log-writer.js";
import { startLogServer } from "./log-server.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

const allowedUsers: Set<number> | null = process.env.TELEGRAM_ALLOWED_USERS
  ? new Set(process.env.TELEGRAM_ALLOWED_USERS.split(",").map((s) => Number(s.trim())))
  : null;

const bot = new Telegraf(token);

// --- Auth middleware ---
bot.use((ctx, next) => {
  if (!allowedUsers) return next();
  const userId = ctx.from?.id;
  if (userId && allowedUsers.has(userId)) return next();
  // Silently ignore unauthorized users
});

// --- /id command ---
bot.command("id", (ctx) => {
  ctx.reply(`Your Telegram user ID is: ${ctx.from.id}`);
});

// --- /start command ---
bot.command("start", (ctx) => {
  ctx.reply("Jarvis online. How can I help?");
});

// --- /reset command ---
bot.command("reset", (ctx) => {
  const chatId = String(ctx.chat.id);
  resetSession(chatId);
  ctx.reply("Session reset. Starting fresh.");
});

// --- Text message handler ---
bot.on(message("text"), async (ctx) => {
  const chatId = String(ctx.chat.id);
  const text = ctx.message.text;

  // Typing indicator — refresh every 4 seconds
  const typingInterval = setInterval(() => {
    ctx.sendChatAction("typing").catch(() => {});
  }, 4_000);
  // Send immediately too
  ctx.sendChatAction("typing").catch(() => {});

  const sessionId = getSessionId(chatId);
  const start = Date.now();

  try {
    const result = await runMainAgent(text, sessionId);

    clearInterval(typingInterval);

    if (isCliError(result)) {
      const userMessage =
        result.type === "timeout"
          ? "Sorry, that took too long. Try a simpler request."
          : "Something went wrong. Please try again.";
      console.error(`[${chatId}] error: ${result.type} — ${result.message}`);
      await ctx.reply(userMessage);
      return;
    }

    // Store session
    if (result.sessionId) {
      setSessionId(chatId, result.sessionId);
    }

    // Log
    const truncated = (s: string, n: number) =>
      s.length > n ? s.slice(0, n) + "..." : s;
    console.log(
      `[${chatId}] ${truncated(text, 50)} → ${truncated(result.result, 80)} (${result.durationMs}ms, $${result.costUsd.toFixed(4)})`,
    );

    // Chunk and reply
    const chunks = chunkMessage(result.result);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    clearInterval(typingInterval);
    console.error(`[${chatId}] unexpected error:`, err);
    await ctx.reply("An unexpected error occurred.");
  }
});

// --- Message chunking ---
const MAX_LENGTH = 4096;

function chunkMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, MAX_LENGTH);

    // Try to split on paragraph boundary
    let splitAt = slice.lastIndexOf("\n\n");
    // Then line boundary
    if (splitAt < MAX_LENGTH / 2) splitAt = slice.lastIndexOf("\n");
    // Then space
    if (splitAt < MAX_LENGTH / 2) splitAt = slice.lastIndexOf(" ");
    // Hard cut as last resort
    if (splitAt < MAX_LENGTH / 2) splitAt = MAX_LENGTH;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

// --- Logging ---
startLogWriter();
if (process.env.JARVIS_LOG_ENABLED !== "false") {
  startLogServer();
}

// --- Startup ---
bot.launch();
console.log("Jarvis is online.");

// --- Graceful shutdown ---
const shutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down...`);
  bot.stop(signal);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
