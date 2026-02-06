/** Enriched event from the Jarvis CLI runner stream */
export interface JarvisEvent {
  type: "system" | "assistant" | "user" | "result";
  subtype?: string;
  _timestamp?: string;
  _agentName?: string;
  _runId?: string;

  // system/init fields
  session_id?: string;
  model?: string;
  tools?: string[];

  // system/hook fields
  hook_name?: string;
  output?: string;
  exit_code?: number;

  // assistant fields
  message?: {
    content?: MessageContent[];
    usage?: TokenUsage;
  };

  // result fields
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  permission_denials?: unknown[];

  // user fields
  tool_use_result?: {
    stdout?: string;
    stderr?: string;
  };
}

export interface MessageContent {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface SessionInfo {
  date: string;
  sessionId: string;
  file: string;
}
