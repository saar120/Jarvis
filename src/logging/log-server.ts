import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { eventBus } from "../core/event-bus.js";
import { discoverAgents } from "../mcp/agent-registry.js";

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

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const meta: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([\w][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    let val: unknown = rawVal.trim();
    if (typeof val === "string" && /^".*"$/.test(val)) val = val.slice(1, -1);
    if (typeof val === "string" && /^\[.*\]$/.test(val)) {
      val = val.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    }
    meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

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

    // Get agents config
    if (url === "/api/agents") {
      const result: {
        mainAgent: { systemPrompt: string; memory: string } | null;
        subAgents: Array<{ slug: string; fileName: string; name: string; description: string | null; tools: string[] | null; prompt: string }>;
        mcpAgents: Array<{
          slug: string; name: string; description: string;
          session: boolean; allowed_callers: string[]; timeout_ms: number;
          permissions: { allow: string[]; deny: string[] };
          mcp_servers: Array<{ name: string; command: string; args?: string[] }>;
          prompt: string;
        }>;
        skills: Array<{ slug: string; dirName: string; name: string; description: string | null; allowedTools: string | null; prompt: string }>;
        settings: unknown;
      } = { mainAgent: null, subAgents: [], mcpAgents: [], skills: [], settings: null };

      // Main agent
      const sysPromptPath = join(jarvisHome, "agents", "main", "system-prompt.md");
      const memoryPath = join(jarvisHome, "agents", "main", "memory.md");
      if (existsSync(sysPromptPath) || existsSync(memoryPath)) {
        result.mainAgent = {
          systemPrompt: existsSync(sysPromptPath) ? readFileSync(sysPromptPath, "utf-8") : "",
          memory: existsSync(memoryPath) ? readFileSync(memoryPath, "utf-8") : "",
        };
      }

      // Sub-agents from .claude/agents/*.md
      const agentsDir = join(jarvisHome, ".claude", "agents");
      if (existsSync(agentsDir)) {
        for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort()) {
          const raw = readFileSync(join(agentsDir, file), "utf-8");
          const { meta, body } = parseFrontmatter(raw);
          result.subAgents.push({
            slug: file.replace(/\.md$/, ""),
            fileName: file,
            name: (meta.name as string) || file.replace(/\.md$/, ""),
            description: (meta.description as string) || null,
            tools: (meta.tools as string[]) || null,
            prompt: body,
          });
        }
      }

      // MCP agents from agents/{name}/agent.md
      try {
        const mcpAgentsMap = discoverAgents();
        for (const [, agent] of mcpAgentsMap) {
          result.mcpAgents.push({
            slug: agent.name,
            name: agent.name,
            description: agent.description,
            session: agent.session,
            allowed_callers: agent.allowed_callers,
            timeout_ms: agent.timeout_ms,
            permissions: agent.permissions,
            mcp_servers: agent.mcp_servers.map(({ name, command, args }) => ({ name, command, args })),
            prompt: agent.systemPrompt,
          });
        }
      } catch { /* agent discovery may fail if yaml not available */ }

      // Skills from .claude/skills/*/SKILL.md
      const skillsDir = join(jarvisHome, ".claude", "skills");
      if (existsSync(skillsDir)) {
        for (const dir of readdirSync(skillsDir).sort()) {
          const skillPath = join(skillsDir, dir, "SKILL.md");
          if (!existsSync(skillPath)) continue;
          const raw = readFileSync(skillPath, "utf-8");
          const { meta, body } = parseFrontmatter(raw);
          result.skills.push({
            slug: dir,
            dirName: dir,
            name: (meta.name as string) || dir,
            description: (meta.description as string) || null,
            allowedTools: (meta["allowed-tools"] as string) || null,
            prompt: body,
          });
        }
      }

      // Settings from .claude/settings.json
      const settingsPath = join(jarvisHome, ".claude", "settings.json");
      if (existsSync(settingsPath)) {
        try { result.settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { /* ignore */ }
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(result));
      return;
    }

    // Ingest events from external processes (MCP subagent server)
    if (req.method === "POST" && url === "/api/events") {
      const MAX_BODY = 1024 * 1024; // 1 MB
      let body = "";
      let aborted = false;
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > MAX_BODY) {
          aborted = true;
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Payload too large" }));
          req.destroy();
        }
      });
      req.on("end", () => {
        if (aborted) return;
        try {
          const event = JSON.parse(body);
          if (!event || typeof event !== "object" || typeof event.type !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Event must have a string 'type' field" }));
            return;
          }
          eventBus.emitEvent(event);
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
        }
      });
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
    console.log(`Jarvis dashboard: http://localhost:${PORT}`);
  });

  return server;
}
