// Extract plain text from uploaded files
import mammoth from "mammoth";
import JSZip from "jszip";

function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ExtractedDoc {
  id: string;
  name: string;
  size: number;
  type: string;
  text: string;
  preview: string;
  /** Original file bytes — kept so we can do format-preserving transforms (e.g. translation). */
  bytes?: ArrayBuffer;
}

async function loadPdfjs(): Promise<any> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return pdfjs;
}

/** OCR a scanned PDF page-by-page in the browser. */
async function ocrPdf(pdf: any, onProgress?: (msg: string) => void): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["eng", "deu", "ron"]);
  const out: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`OCR page ${i}/${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data } = await worker.recognize(canvas);
      out.push(data.text || "");
    }
  } finally {
    await worker.terminate();
  }
  return out.join("\n\n");
}

async function extractPdfFromBuffer(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({
    data: buf.slice(0),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out.push(content.items.map((it: any) => it.str).join(" "));
  }
  const text = out.join("\n\n");
  // Scanned PDF: little or no embedded text → fall back to OCR.
  if (text.replace(/\s+/g, "").length < 40 * pdf.numPages) {
    try {
      console.log("[pdf] little text found — running OCR");
      const ocr = await ocrPdf(pdf, (m) => console.log("[pdf]", m));
      if (ocr.replace(/\s+/g, "").length > text.replace(/\s+/g, "").length) return ocr;
    } catch (e) {
      console.error("[pdf] OCR failed", e);
    }
  }
  return text;
}


async function extractDocxFromBuffer(buf: ArrayBuffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value;
}

async function extractPptxFromBuffer(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)![1]);
      const nb = parseInt(b.match(/slide(\d+)/)![1]);
      return na - nb;
    });
  const parts: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const xml = await zip.files[slides[i]].async("string");
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map((m) => m[1]);
    parts.push(`# Slide ${i + 1}\n${texts.join("\n")}`);
  }
  return parts.join("\n\n");
}


export async function extractDocument(file: File): Promise<ExtractedDoc> {
  const name = file.name.toLowerCase();
  let text = "";
  let bytes: ArrayBuffer | undefined;
  try {
    bytes = await file.arrayBuffer();
    if (name.endsWith(".pdf")) text = await extractPdfFromBuffer(bytes);
    else if (name.endsWith(".docx")) text = await extractDocxFromBuffer(bytes);
    else if (name.endsWith(".pptx")) text = await extractPptxFromBuffer(bytes);
    else text = new TextDecoder().decode(bytes);
  } catch (e: any) {
    text = `[Failed to extract: ${e?.message || "unknown error"}]`;
  }
  const preview = text.slice(0, 280).replace(/\s+/g, " ").trim();
  return {
    id: uid(),
    name: file.name,
    size: file.size,
    type: file.type || name.split(".").pop() || "file",
    text,
    preview,
    bytes,
  };
}

export function truncateForContext(text: string, maxChars = 18000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n[...content truncated...]\n\n${tail}`;
}
