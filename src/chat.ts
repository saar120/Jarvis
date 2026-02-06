import { createInterface } from "node:readline";
import { runMainAgent, isCliError } from "./cli-runner.js";
import { getSessionId, setSessionId, resetSession } from "./session-store.js";
import { startLogWriter } from "./log-writer.js";
import { startLogServer } from "./log-server.js";

// --- Logging ---
startLogWriter();
if (process.env.JARVIS_LOG_ENABLED !== "false") {
  startLogServer();
}

const CHAT_ID = "cli";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): void {
  rl.question("jarvis> ", async (input) => {
    const trimmed = input.trim();

    if (!trimmed) {
      prompt();
      return;
    }

    if (trimmed === "/exit") {
      console.log("Goodbye.");
      rl.close();
      return;
    }

    if (trimmed === "/reset") {
      resetSession(CHAT_ID);
      console.log("Session reset.");
      prompt();
      return;
    }

    const sessionId = getSessionId(CHAT_ID);

    // Show a spinner while waiting
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    const spinner = setInterval(() => {
      process.stdout.write(`\r${frames[i++ % frames.length]} Thinking...`);
    }, 100);

    const result = await runMainAgent(trimmed, sessionId);

    clearInterval(spinner);
    process.stdout.write("\r\x1b[K"); // clear spinner line

    if (isCliError(result)) {
      console.error(`[error] ${result.type}: ${result.message}`);
    } else {
      if (result.sessionId) {
        setSessionId(CHAT_ID, result.sessionId);
      }
      console.log(result.result);
    }

    prompt();
  });
}

console.log("Jarvis CLI — type /exit to quit, /reset to clear session");
prompt();

rl.on("close", () => {
  process.exit(0);
});
