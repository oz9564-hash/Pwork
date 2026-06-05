import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { ColumnPdf, FieldRow, FontAsset, PdfArea, ValueColumn } from "../types";

export async function exportPdf(
  pdf: ColumnPdf,
  rows: FieldRow[],
  column: ValueColumn,
  areas: PdfArea[],
  fontAsset?: FontAsset,
  imageFiles: Record<string, Blob> = {},
) {
  if (!pdf.file) throw new Error("PDF 원본을 불러오지 못했습니다.");
  const bytes = await pdf.file.arrayBuffer();
  const pdfDocument = await PDFDocument.load(bytes);
  pdfDocument.registerFontkit(fontkit);

  const font = fontAsset
    ? await pdfDocument.embedFont(await fontAsset.file.arrayBuffer())
    : await embedDefaultFont(pdfDocument);

  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const area of areas) {
    const page = pdfDocument.getPage(area.page - 1);
    if (!page) continue;

    const row = rowsById.get(area.rowId);
    if (!row) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();
    const x = area.x * pageWidth;
    const boxTop = area.y * pageHeight;
    const boxHeight = area.height * pageHeight;
    const imageFile = imageFiles[row.id];

    if (imageFile) {
      const imageBytes = await imageFile.arrayBuffer();
      const image =
        imageFile.type === "image/png"
          ? await pdfDocument.embedPng(imageBytes)
          : await pdfDocument.embedJpg(imageBytes);

      page.drawImage(image, {
        x,
        y: pageHeight - boxTop - boxHeight,
        width: area.width * pageWidth,
        height: boxHeight,
      });
      continue;
    }

    const text = column.values[row.id] ?? "";
    if (!text) continue;

    const y = pageHeight - boxTop - area.fontSize;

    page.drawText(text, {
      x,
      y,
      size: area.fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: area.width * pageWidth,
    });
  }

  const output = await pdfDocument.save();
  const outputBuffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(outputBuffer).set(output);
  const blob = new Blob([outputBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${column.name}_${pdf.name.replace(/\.pdf$/i, "")}_filled.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function embedDefaultFont(pdfDocument: PDFDocument) {
  const candidates = ["fonts/human-myeongjo.ttf", "fonts/H2MJRE.ttf", "fonts/batang.ttc"];

  for (const path of candidates) {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
      if (!response.ok) continue;
      return await pdfDocument.embedFont(await response.arrayBuffer());
    } catch {
      continue;
    }
  }

  return pdfDocument.embedFont(StandardFonts.Helvetica);
}
