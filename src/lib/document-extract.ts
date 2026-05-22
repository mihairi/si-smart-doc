// Extract plain text from uploaded files
import mammoth from "mammoth";
import JSZip from "jszip";

export interface ExtractedDoc {
  id: string;
  name: string;
  size: number;
  type: string;
  text: string;
  preview: string;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out.push(content.items.map((it: any) => it.str).join(" "));
  }
  return out.join("\n\n");
}

async function extractDocx(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value;
}

async function extractPptx(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
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

async function extractText(file: File): Promise<string> {
  return await file.text();
}

export async function extractDocument(file: File): Promise<ExtractedDoc> {
  const name = file.name.toLowerCase();
  let text = "";
  try {
    if (name.endsWith(".pdf")) text = await extractPdf(file);
    else if (name.endsWith(".docx")) text = await extractDocx(file);
    else if (name.endsWith(".pptx")) text = await extractPptx(file);
    else if (name.match(/\.(txt|md|csv|json|html?|xml|log)$/)) text = await extractText(file);
    else text = await extractText(file);
  } catch (e: any) {
    text = `[Failed to extract: ${e?.message || "unknown error"}]`;
  }
  const preview = text.slice(0, 280).replace(/\s+/g, " ").trim();
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type || name.split(".").pop() || "file",
    text,
    preview,
  };
}

export function truncateForContext(text: string, maxChars = 18000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n[...content truncated...]\n\n${tail}`;
}
