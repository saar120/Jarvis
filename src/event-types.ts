// Event types emitted by `claude -p --output-format stream-json --verbose`

// --- Enrichment fields added by our parser ---

export interface Enrichment {
  _timestamp: number;   // Date.now() when event was received
  _agentName: string;   // "main" or sub-agent type (e.g. "ping-pong")
  _runId: string;       // unique ID per runMainAgent() invocation
}

// --- Content blocks ---

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

// --- Token usage ---

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// --- System events ---

export interface SystemInitEvent extends Enrichment {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: string[];
  model: string;
  cwd?: string;
  agents?: string[];
  skills?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  claude_code_version?: string;
}

export interface SystemHookEvent extends Enrichment {
  type: "system";
  subtype: "hook_started" | "hook_response";
  session_id: string;
  hook_name?: string;
  hook_event?: string;
  hook_id?: string;
  output?: string;
  exit_code?: number;
}

export type SystemEvent = SystemInitEvent | SystemHookEvent;

// --- Assistant events ---

export interface AssistantEvent extends Enrichment {
  type: "assistant";
  session_id: string;
  message: {
    id: string;
    model: string;
    role: "assistant";
    content: Array<TextContent | ToolUseContent>;
    usage?: TokenUsage;
  };
  parent_tool_use_id: string | null;
}

// --- User events (tool results) ---

export interface UserEvent extends Enrichment {
  type: "user";
  session_id: string;
  message: {
    role: "user";
    content: Array<ToolResultContent | TextContent>;
  };
  parent_tool_use_id: string | null;
  tool_use_result?: {
    stdout?: string;
    stderr?: string;
    status?: string;
    agentId?: string;
    content?: Array<{ type: string; text: string }>;
    totalDurationMs?: number;
  };
}

// --- Result event (final summary) ---

export interface ResultEvent extends Enrichment {
  type: "result";
  subtype: string;
  session_id: string;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms?: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage?: Record<string, TokenUsage>;
  permission_denials?: Array<{ tool_name: string; tool_use_id: string }>;
}

// --- Union type ---

export type StreamEvent = SystemEvent | AssistantEvent | UserEvent | ResultEvent;
