// Adapted from project DocAIremix — local LLM service (Ollama / LM Studio)

export type LLMProvider = "ollama" | "lmstudio";

export interface LLMConfig {
  provider: LLMProvider;
  host: string;
  port: string;
  model: string;
  thinking?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULTS: Record<LLMProvider, Omit<LLMConfig, "model">> = {
  ollama: { provider: "ollama", host: "127.0.0.1", port: "11434" },
  lmstudio: { provider: "lmstudio", host: "127.0.0.1", port: "1234" },
};

export function getDefaultConfig(provider: LLMProvider): Omit<LLMConfig, "model"> {
  return DEFAULTS[provider];
}

export function getBaseUrl(config: LLMConfig): string {
  const host = config.host || "127.0.0.1";
  const port = config.port || (config.provider === "ollama" ? "11434" : "1234");
  return `http://${host}:${port}`;
}

export async function fetchModels(config: LLMConfig): Promise<string[]> {
  const base = getBaseUrl(config);
  try {
    if (config.provider === "ollama") {
      const res = await fetch(`${base}/api/tags`);
      const data = await res.json();
      return (data.models || []).map((m: any) => m.name);
    }
    const res = await fetch(`${base}/v1/models`);
    const data = await res.json();
    return (data.data || []).map((m: any) => m.id);
  } catch (e) {
    console.error("fetchModels failed", e);
    return [];
  }
}

export async function streamChat({
  config,
  messages,
  onDelta,
  onDone,
  onError,
  signal,
}: {
  config: LLMConfig;
  messages: ChatMessage[];
  onDelta: (t: string) => void;
  onDone: () => void;
  onError: (m: string) => void;
  signal?: AbortSignal;
}) {
  const base = getBaseUrl(config);
  try {
    if (config.provider === "ollama") {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          ...(config.thinking ? { think: true } : {}),
        }),
        signal,
      });
      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const p = JSON.parse(line);
            if (p.message?.content) onDelta(p.message.content);
            if (p.done) {
              onDone();
              return;
            }
          } catch {}
        }
      }
      onDone();
    } else {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.model, messages, stream: true }),
        signal,
      });
      if (!res.ok) throw new Error(`LM Studio error ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          if (json === "[DONE]") {
            onDone();
            return;
          }
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) onDelta(c);
          } catch {}
        }
      }
      onDone();
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return;
    const msg = e?.message || "Connection failed";
    if (msg.toLowerCase().includes("failed to fetch")) {
      onError(
        "Cannot reach the local LLM. Check that Ollama or LM Studio is running and that host/port match Settings."
      );
      return;
    }
    onError(msg);
  }
}

const KEY = "corpdoc-llm-config";
export function loadConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { ...DEFAULTS.ollama, model: "" };
}
export function saveConfig(c: LLMConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
}
