import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { saveAs } from "file-saver";

function parseMarkdownToParagraphs(md: string): Paragraph[] {
  const lines = md.split(/\r?\n/);
  const paras: Paragraph[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      paras.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const heading =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
          ? HeadingLevel.HEADING_2
          : level === 3
          ? HeadingLevel.HEADING_3
          : HeadingLevel.HEADING_4;
      paras.push(new Paragraph({ heading, children: [new TextRun({ text: h[2], bold: true })] }));
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      paras.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(bullet[1])] }));
      continue;
    }
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (num) {
      paras.push(new Paragraph({ children: [new TextRun(`• ${num[1]}`)] }));
      continue;
    }
    // bold **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    const runs = parts.map((p) =>
      p.startsWith("**") && p.endsWith("**")
        ? new TextRun({ text: p.slice(2, -2), bold: true })
        : new TextRun(p)
    );
    paras.push(new Paragraph({ children: runs }));
  }
  return paras;
}

export async function exportToDocx(title: string, markdown: string, filename: string) {
  const doc = new Document({
    creator: "Lex Corporate Docs",
    title,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: title, bold: true })],
          }),
          new Paragraph({ children: [new TextRun({ text: new Date().toLocaleString(), italics: true })] }),
          new Paragraph({ children: [new TextRun("")] }),
          ...parseMarkdownToParagraphs(markdown),
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename.endsWith(".docx") ? filename : `${filename}.docx`);
}
