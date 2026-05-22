import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Scale, ShieldCheck, FileStack } from "lucide-react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { DocumentUploader } from "@/components/DocumentUploader";
import { TaskWorkbench } from "@/components/TaskWorkbench";
import { Toaster } from "@/components/ui/toaster";
import { loadConfig, type LLMConfig } from "@/lib/llm-service";
import type { ExtractedDoc } from "@/lib/document-extract";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Lex · Corporate Document AI Workbench" },
      {
        name: "description",
        content:
          "Compare, enhance, draft and verify corporate documents and policies with a local LLM. PDF, DOCX and PPTX in — polished Markdown and Word out.",
      },
      { property: "og:title", content: "Lex · Corporate Document AI Workbench" },
      {
        property: "og:description",
        content: "Run document comparison, compliance checks and policy drafting on a local LLM.",
      },
    ],
  }),
});

function Index() {
  const [config, setConfig] = useState<LLMConfig>(() => loadConfig());
  const [docs, setDocs] = useState<ExtractedDoc[]>([]);

  return (
    <div className="min-h-screen bg-background bg-grain text-foreground">
      <Toaster />

      {/* Top bar */}
      <header className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-sm bg-primary text-primary-foreground grid place-items-center">
              <Scale className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-xl">Lex</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono">
                Corporate Document AI
              </div>
            </div>
          </div>
          <SettingsPanel config={config} onChange={setConfig} />
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-6 py-12 grid md:grid-cols-12 gap-10 items-end">
          <div className="md:col-span-8">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="font-display text-5xl md:text-6xl leading-[1.05]"
            >
              Read every clause.
              <br />
              <span className="text-primary italic">Draft every revision.</span>
            </motion.h1>
            <p className="mt-5 max-w-2xl text-muted-foreground text-base leading-relaxed">
              A private workbench for legal, compliance and policy teams. Upload regulations,
              contracts and decks; let a local LLM compare, harmonise and rewrite them — without
              a single byte leaving your network.
            </p>
          </div>
          <div className="md:col-span-4 grid grid-cols-2 gap-3">
            <Stat icon={<ShieldCheck className="h-4 w-4" />} label="On-prem" value="100%" />
            <Stat icon={<FileStack className="h-4 w-4" />} label="Formats" value="PDF·DOCX·PPTX" />
          </div>
        </div>
      </section>

      {/* Workbench */}
      <main className="mx-auto max-w-7xl px-6 py-10 grid lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl">Corpus</h2>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
              {docs.length} loaded
            </span>
          </div>
          <DocumentUploader docs={docs} onChange={setDocs} />
        </aside>

        <section className="lg:col-span-8 space-y-3">
          <h2 className="font-display text-xl">Workbench</h2>
          <TaskWorkbench config={config} docs={docs} />
        </section>
      </main>

      <footer className="border-t border-hairline mt-10">
        <div className="mx-auto max-w-7xl px-6 py-6 text-[11px] text-muted-foreground font-mono flex flex-wrap gap-x-4 gap-y-1 items-center">
          <span>Lex · Private corporate AI workbench</span>
          <span>·</span>
          <span>Powered by your local Ollama / LM Studio</span>
          <span className="ml-auto">{new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-[10px] uppercase tracking-widest font-mono">
        {icon}
        {label}
      </div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}
