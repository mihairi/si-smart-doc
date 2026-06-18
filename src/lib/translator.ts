// Format-preserving document translation between English / German / Romanian.
// Strategy:
//  - DOCX & PPTX: unzip with JSZip, find text runs in the XML and translate their
//    inner text only, leaving every formatting tag intact, then re-zip.
//  - TXT / MD / CSV / JSON / HTML / XML: translate the raw text and keep the
//    original extension.
//  - PDF: format-preserving rewrites are not feasible client-side; we export a
//    translated .docx instead.

import JSZip from "jszip";
import { chatComplete, type LLMConfig } from "./llm-service";
import type { ExtractedDoc } from "./document-extract";
import { exportToDocx } from "./docx-export";

export type Language = "English" | "German" | "Romanian";
export const LANGUAGES: Language[] = ["English", "German", "Romanian"];

export interface TranslateProgress {
  done: number;
  total: number;
  stage: string;
}

const BATCH_SIZE = 16;

function buildPrompt(target: Language, source: Language | "auto") {
  const src = source === "auto" ? "auto-detected source language" : source;
  return `You are a professional translator. Translate the following numbered paragraphs from ${src} into ${target}.

Translation rules:
- Translate naturally, considering the full sentence and paragraph context, not word-by-word.
- Preserve meaning, tone, register and overall punctuation.
- Do NOT translate proper nouns, code, URLs or numbers.
- Some paragraphs contain inline markers like ⟦2⟧, ⟦3⟧ that mark formatting boundaries inside the sentence. You MUST keep every such marker, in the same order, placed at the equivalent position in the translated sentence. Never invent, drop or renumber them.

Output rules:
- Return EXACTLY the same number of paragraphs, in the same order.
- One paragraph per line, prefixed with its number and a pipe, like:
  1| translated text
  2| translated text with ⟦2⟧ marker preserved
- No commentary, no headings, no blank lines.`;
}

async function translateBatch(
  config: LLMConfig,
  texts: string[],
  target: Language,
  source: Language | "auto",
  signal?: AbortSignal
): Promise<string[]> {
  // Collapse hard newlines so each paragraph fits on one output line.
  const numbered = texts
    .map((t, i) => `${i + 1}| ${t.replace(/\r?\n/g, " ⏎ ")}`)
    .join("\n");
  const raw = await chatComplete({
    config,
    messages: [
      { role: "system", content: buildPrompt(target, source) },
      { role: "user", content: numbered },
    ],
    signal,
  });
  const map = new Map<number, string>();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*\|\s*(.*)$/);
    if (m) map.set(parseInt(m[1], 10), m[2].replace(/ ?⏎ ?/g, "\n"));
  }
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) out.push(map.get(i + 1) ?? texts[i]);
  return out;
}

async function translateMany(
  config: LLMConfig,
  texts: string[],
  target: Language,
  source: Language | "auto",
  onProgress?: (p: TranslateProgress) => void,
  signal?: AbortSignal
): Promise<string[]> {
  const result: string[] = new Array(texts.length);
  const idxs = texts
    .map((t, i) => ({ t, i }))
    .filter((x) => x.t && x.t.trim().length > 0);
  const total = idxs.length;
  let done = 0;
  // Smaller batch — each item is now a whole paragraph, not a single run.
  const BATCH = 8;
  for (let i = 0; i < idxs.length; i += BATCH) {
    if (signal?.aborted) throw new Error("Aborted");
    const slice = idxs.slice(i, i + BATCH);
    const translated = await translateBatch(
      config,
      slice.map((s) => s.t),
      target,
      source,
      signal
    );
    slice.forEach((s, k) => {
      result[s.i] = translated[k];
    });
    done += slice.length;
    onProgress?.({ done, total, stage: `Translating ${done}/${total} paragraphs` });
  }
  for (let i = 0; i < texts.length; i++) {
    if (result[i] === undefined) result[i] = texts[i];
  }
  return result;
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Markers used to encode formatting-run boundaries inside a paragraph so the
// model can translate the whole sentence at once with full context. We tell
// the model to preserve them verbatim, then split back into the original runs.
const MARK = (n: number) => `⟦${n}⟧`;
const MARK_RE = /⟦(\d+)⟧/g;

async function translateOoxmlPart(
  xml: string,
  tag: "w:t" | "a:t",
  paraTag: "w:p" | "a:p",
  config: LLMConfig,
  target: Language,
  source: Language | "auto",
  onProgress?: (p: TranslateProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  // 1. Locate every text run with its absolute position.
  const runRe = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
  const runs: { start: number; end: number; attrs: string; text: string }[] = [];
  let rm: RegExpExecArray | null;
  while ((rm = runRe.exec(xml)) !== null) {
    runs.push({
      start: rm.index,
      end: rm.index + rm[0].length,
      attrs: rm[1],
      text: decodeXml(rm[2]),
    });
  }
  if (!runs.length) return xml;

  // 2. Group runs by enclosing paragraph so each LLM request sees a full
  // sentence / paragraph in context.
  const paraRe = new RegExp(`<${paraTag}\\b[^>]*>[\\s\\S]*?</${paraTag}>`, "g");
  const paragraphs: { start: number; end: number; runIdxs: number[] }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml)) !== null) {
    paragraphs.push({
      start: pm.index,
      end: pm.index + pm[0].length,
      runIdxs: [],
    });
  }
  const orphanGroups: number[][] = [];
  runs.forEach((r, i) => {
    const p = paragraphs.find((pp) => r.start >= pp.start && r.end <= pp.end);
    if (p) p.runIdxs.push(i);
    else orphanGroups.push([i]);
  });
  const groups: number[][] = [
    ...paragraphs.filter((p) => p.runIdxs.length).map((p) => p.runIdxs),
    ...orphanGroups,
  ];

  // 3. Build one contextual string per paragraph with markers between runs.
  const groupTexts: string[] = groups.map((idxs) =>
    idxs.map((ri, k) => (k === 0 ? "" : MARK(k + 1)) + runs[ri].text).join("")
  );

  // 4. Translate paragraphs with full context.
  const translated = await translateMany(
    config,
    groupTexts,
    target,
    source,
    onProgress,
    signal
  );

  // 5. Split translated paragraphs back into runs by their markers.
  const newRunText: string[] = runs.map((r) => r.text);
  groups.forEach((idxs, gi) => {
    const tr = translated[gi] ?? groupTexts[gi];
    if (idxs.length === 1) {
      newRunText[idxs[0]] = tr;
      return;
    }
    const parts: string[] = [];
    let lastIdx = 0;
    let mm: RegExpExecArray | null;
    MARK_RE.lastIndex = 0;
    while ((mm = MARK_RE.exec(tr)) !== null) {
      parts.push(tr.slice(lastIdx, mm.index));
      lastIdx = mm.index + mm[0].length;
    }
    parts.push(tr.slice(lastIdx));

    if (parts.length === idxs.length) {
      parts.forEach((p, k) => {
        newRunText[idxs[k]] = p;
      });
    } else {
      // Marker count mismatch — keep all translated text in the first run so
      // nothing is lost; some inline styling boundaries may be merged.
      newRunText[idxs[0]] = tr.replace(MARK_RE, "");
      for (let k = 1; k < idxs.length; k++) newRunText[idxs[k]] = "";
    }
  });

  // 6. Rewrite the XML preserving every formatting tag untouched.
  let out = "";
  let cursor = 0;
  runs.forEach((r, i) => {
    out += xml.slice(cursor, r.start);
    out += `<${tag}${r.attrs}>${escapeXml(newRunText[i])}</${tag}>`;
    cursor = r.end;
  });
  out += xml.slice(cursor);
  return out;
}

async function translateDocx(
  bytes: ArrayBuffer,
  config: LLMConfig,
  target: Language,
  source: Language | "auto",
  onProgress?: (p: TranslateProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const zip = await JSZip.loadAsync(bytes);
  const partNames = Object.keys(zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n)
  );
  for (const name of partNames) {
    const xml = await zip.files[name].async("string");
    const updated = await translateOoxmlPart(
      xml,
      "w:t",
      config,
      target,
      source,
      (p) => onProgress?.({ ...p, stage: `${name}: ${p.stage}` }),
      signal
    );
    zip.file(name, updated);
  }
  return await zip.generateAsync({ type: "blob" });
}

async function translatePptx(
  bytes: ArrayBuffer,
  config: LLMConfig,
  target: Language,
  source: Language | "auto",
  onProgress?: (p: TranslateProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const zip = await JSZip.loadAsync(bytes);
  const partNames = Object.keys(zip.files).filter((n) =>
    /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(n)
  );
  for (const name of partNames) {
    const xml = await zip.files[name].async("string");
    const updated = await translateOoxmlPart(
      xml,
      "a:t",
      config,
      target,
      source,
      (p) => onProgress?.({ ...p, stage: `${name}: ${p.stage}` }),
      signal
    );
    zip.file(name, updated);
  }
  return await zip.generateAsync({ type: "blob" });
}

async function translatePlainText(
  text: string,
  config: LLMConfig,
  target: Language,
  source: Language | "auto",
  onProgress?: (p: TranslateProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  // Split on blank lines / paragraphs to preserve structure.
  const segments = text.split(/(\r?\n\s*\r?\n)/); // keep separators
  const payload: string[] = [];
  const slots: number[] = [];
  segments.forEach((s, i) => {
    if (i % 2 === 0 && s.trim()) {
      slots.push(i);
      payload.push(s);
    }
  });
  if (!payload.length) return text;
  const translated = await translateMany(config, payload, target, source, onProgress, signal);
  const out = segments.slice();
  slots.forEach((idx, k) => {
    out[idx] = translated[k];
  });
  return out.join("");
}

function changeExt(name: string, ext: string) {
  const i = name.lastIndexOf(".");
  return (i === -1 ? name : name.slice(0, i)) + ext;
}

function langTag(l: Language) {
  return l === "English" ? "en" : l === "German" ? "de" : "ro";
}

export interface TranslateResult {
  blob: Blob;
  filename: string;
  notice?: string;
}

export async function translateDocument(opts: {
  doc: ExtractedDoc;
  config: LLMConfig;
  target: Language;
  source?: Language | "auto";
  onProgress?: (p: TranslateProgress) => void;
  signal?: AbortSignal;
}): Promise<TranslateResult> {
  const { doc, config, target, source = "auto", onProgress, signal } = opts;
  if (!doc.bytes) throw new Error("Original file bytes are unavailable for translation.");
  const lower = doc.name.toLowerCase();
  const tag = langTag(target);
  const baseName = doc.name.replace(/\.[^.]+$/, "");

  if (lower.endsWith(".docx")) {
    const blob = await translateDocx(doc.bytes, config, target, source, onProgress, signal);
    return { blob, filename: `${baseName}.${tag}.docx` };
  }
  if (lower.endsWith(".pptx")) {
    const blob = await translatePptx(doc.bytes, config, target, source, onProgress, signal);
    return { blob, filename: `${baseName}.${tag}.pptx` };
  }
  if (lower.endsWith(".pdf")) {
    // PDF cannot be edited in-place from the browser — export translated text as DOCX.
    const translatedText = await translatePlainText(doc.text, config, target, source, onProgress, signal);
    const filename = `${baseName}.${tag}.docx`;
    await exportToDocx(`${baseName} (${target})`, translatedText, filename);
    return {
      blob: new Blob(),
      filename,
      notice: "PDF formatting cannot be preserved client-side — delivered as a Word document.",
    };
  }
  // Plain text-ish formats: keep extension.
  const decoded =
    doc.text && !doc.text.startsWith("[Failed")
      ? doc.text
      : new TextDecoder().decode(doc.bytes);
  const translated = await translatePlainText(decoded, config, target, source, onProgress, signal);
  const blob = new Blob([translated], { type: "text/plain;charset=utf-8" });
  return { blob, filename: changeExt(doc.name, `.${tag}${lower.match(/\.[a-z0-9]+$/)?.[0] || ".txt"}`) };
}

export function downloadBlob(blob: Blob, filename: string) {
  if (!blob.size) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
