import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import {
  Sparkles,
  Loader2,
  Square,
  Download,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TASKS, buildPrompt, type TaskId } from "@/lib/tasks";
import { type LLMConfig, streamChat } from "@/lib/llm-service";
import type { ExtractedDoc } from "@/lib/document-extract";
import { exportToDocx } from "@/lib/docx-export";
import { TranslatorPanel } from "./TranslatorPanel";
import { toast } from "sonner";

interface Props {
  config: LLMConfig;
  docs: ExtractedDoc[];
}

export function TaskWorkbench({ config, docs }: Props) {
  const [task, setTask] = useState<TaskId>("compare");
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeTask = useMemo(() => TASKS.find((t) => t.id === task)!, [task]);
  const enoughDocs = docs.length >= activeTask.minDocs;
  const canRun = enoughDocs && !!config.model && !running;

  const run = async () => {
    if (!canRun) return;
    setOutput("");
    setErr(null);
    setRunning(true);
    const { system, user } = buildPrompt({ task, docs, userInstruction: instruction });
    const ctl = new AbortController();
    abortRef.current = ctl;
    await streamChat({
      config,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      onDelta: (t) => setOutput((p) => p + t),
      onDone: () => setRunning(false),
      onError: (m) => {
        setErr(m);
        setRunning(false);
      },
      signal: ctl.signal,
    });
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const onCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onExport = async () => {
    if (!output.trim()) return;
    const title = `${activeTask.label} — ${new Date().toLocaleDateString()}`;
    await exportToDocx(title, output, `lex-${task}-${Date.now()}.docx`);
    toast.success("Word document downloaded.");
  };

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
          Task
        </Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {TASKS.map((t) => {
            const active = t.id === task;
            return (
              <button
                key={t.id}
                onClick={() => setTask(t.id)}
                className={`text-left rounded-md border p-3 transition-all ${
                  active
                    ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--primary)]"
                    : "border-hairline bg-surface hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-medium leading-tight">{t.label}</div>
                <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                  {t.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {task === "translate" ? (
        <TranslatorPanel config={config} docs={docs} />
      ) : (
        <>
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Instructions
        </Label>
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={activeTask.promptHint}
          rows={3}
          className="mt-1 bg-surface resize-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <Button
            onClick={run}
            disabled={!canRun}
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Run on local LLM
          </Button>
        ) : (
          <Button onClick={stop} variant="destructive" className="gap-2">
            <Square className="h-4 w-4" />
            Stop
          </Button>
        )}
        {!enoughDocs && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            Needs {activeTask.minDocs} document{activeTask.minDocs > 1 ? "s" : ""}
          </span>
        )}
        {!config.model && (
          <span className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            Configure a model in LLM Admin
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCopy} disabled={!output} className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={onExport} disabled={!output} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Export .docx
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <motion.div
        initial={false}
        animate={{ opacity: output || running ? 1 : 0.6 }}
        className="rounded-md border border-hairline bg-surface min-h-[280px] p-5"
      >
        {!output && !running && (
          <div className="text-sm text-muted-foreground italic">
            Output will appear here. Streaming token-by-token from your local model.
          </div>
        )}
        {running && !output && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
        {output && (
          <article className="prose prose-sm prose-invert max-w-none prose-headings:font-display prose-headings:tracking-tight prose-p:leading-relaxed">
            <ReactMarkdown>{output}</ReactMarkdown>
            {running && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
          </article>
        )}
      </motion.div>
    </div>
  );
}
