import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { eventBus } from "../core/event-bus.js";

const PORT = Number(process.env.JARVIS_LOG_PORT) || 7777;
const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const logsRoot = join(jarvisHome, "data", "logs");
const guiDist = join(jarvisHome, "gui", "dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

import type { Server } from "node:http";

function serveStatic(res: import("node:http").ServerResponse, filePath: string): boolean {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(guiDist))) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return true;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return false;
  const ext = extname(resolved);
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  res.end(readFileSync(resolved));
  return true;
}

export function startLogServer(): Server {
  const server = createServer((req, res) => {
    const url = req.url || "/";

    // Serve Vue SPA — try exact file first, fall back to index.html
    if (!url.startsWith("/api/")) {
      const cleanUrl = url.split("?")[0];
      // Try serving exact file from dist
      if (cleanUrl !== "/" && serveStatic(res, join(guiDist, cleanUrl))) return;
      // Serve index.html for SPA routing
      const indexPath = join(guiDist, "index.html");
      if (existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(indexPath, "utf-8"));
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("GUI not found. Run 'npm run build:gui' first.");
      return;
    }

    // List sessions
    if (url === "/api/sessions") {
      const sessions: Array<{ date: string; sessionId: string; file: string }> = [];
      if (existsSync(logsRoot)) {
        const dates = readdirSync(logsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
        for (const date of dates) {
          const dir = join(logsRoot, date);
          const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
          for (const file of files) {
            sessions.push({
              date,
              sessionId: file.replace(".jsonl", ""),
              file: `${date}/${file}`,
            });
          }
        }
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(sessions));
      return;
    }

    // Get session events
    const sessionMatch = url.match(/^\/api\/session\/(\d{4}-\d{2}-\d{2})\/([a-f0-9-]+)$/);
    if (sessionMatch) {
      const [, date, sessionId] = sessionMatch;
      const filePath = join(logsRoot, date, `${sessionId}.jsonl`);
      // Verify path stays inside logsRoot
      const resolvedPath = resolve(filePath);
      const resolvedRoot = resolve(logsRoot);
      if (!resolvedPath.startsWith(resolvedRoot + "/")) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }
      if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
      const content = readFileSync(filePath, "utf-8");
      const events = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(events));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server });

  // Broadcast live events to all connected WebSocket clients
  eventBus.onEvent((event) => {
    const data = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "connected", message: "Jarvis log stream connected" }));
  });

  server.listen(PORT, () => {
    console.log(`Jarvis log viewer: http://localhost:${PORT}`);
  });

  return server;
}
