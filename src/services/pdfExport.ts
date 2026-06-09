import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { ColumnPdfAdjust, FieldRow, FontAsset, PdfArea, ValueColumn } from "../types";

export type ExportPdfParams = {
  /** 공통 PDF 원본. */
  file: Blob;
  /** 다운로드 파일명에 쓰는 공통 PDF 이름. */
  fileName: string;
  rows: FieldRow[];
  column: ValueColumn;
  /** 기준 영역(레이아웃 원본). */
  areas: PdfArea[];
  /** 이 열의 미세조정 보정. 없으면 기준 그대로. */
  adjust?: ColumnPdfAdjust;
  fontAsset?: FontAsset;
  imageFiles?: Record<string, Blob>;
};

/** 기준 영역에 이 열의 전체 오프셋 + 개별 보정을 더한 정규화 좌표를 돌려준다. */
export function effectiveAreaPosition(area: PdfArea, adjust?: ColumnPdfAdjust) {
  const override = adjust?.overrides?.[area.id];
  const dx = (adjust?.dx ?? 0) + (override?.dx ?? 0);
  const dy = (adjust?.dy ?? 0) + (override?.dy ?? 0);
  return { x: area.x + dx, y: area.y + dy };
}

export async function exportPdf({
  file,
  fileName,
  rows,
  column,
  areas,
  adjust,
  fontAsset,
  imageFiles = {},
}: ExportPdfParams) {
  const bytes = await file.arrayBuffer();
  const pdfDocument = await PDFDocument.load(bytes);
  pdfDocument.registerFontkit(fontkit);

  const font = await embedUsableFont(pdfDocument, fontAsset);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const area of areas) {
    const page = pdfDocument.getPage(area.page - 1);
    if (!page) continue;

    const row = rowsById.get(area.rowId);
    if (!row) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();
    const pos = effectiveAreaPosition(area, adjust);
    const x = pos.x * pageWidth;
    const boxTop = pos.y * pageHeight;
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

    // 영역 너비를 넘으면 한 줄에 맞도록 글자 크기를 줄여서 그린다.
    const maxWidth = area.width * pageWidth;
    let size = area.fontSize;
    const measured = font.widthOfTextAtSize(text, size);
    if (measured > maxWidth && measured > 0) {
      size = Math.max(4, size * (maxWidth / measured));
    }
    const y = pageHeight - boxTop - size;

    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const output = await pdfDocument.save();
  const outputBuffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(outputBuffer).set(output);
  const blob = new Blob([outputBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${column.name}_${fileName.replace(/\.pdf$/i, "")}_filled.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function embedUsableFont(pdfDocument: PDFDocument, fontAsset?: FontAsset) {
  if (fontAsset) {
    try {
      // subset: true → 실제 사용된 글리프만 임베드한다. 한글 TTF는 수 MB라
      // 전체 임베드 시 결과 PDF가 비대해지고 생성도 느려진다.
      const font = await pdfDocument.embedFont(await fontAsset.file.arrayBuffer(), { subset: true });
      font.widthOfTextAtSize("test", 12);
      return font;
    } catch (error) {
      console.error("[pdf-download] custom font failed, fallback to default font", error);
    }
  }

  return embedDefaultFont(pdfDocument);
}

async function embedDefaultFont(pdfDocument: PDFDocument) {
  const candidates = ["fonts/human-myeongjo.ttf", "fonts/malgun.ttf"];

  for (const path of candidates) {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
      if (!response.ok) continue;
      const font = await pdfDocument.embedFont(await response.arrayBuffer(), { subset: true });
      font.widthOfTextAtSize("test", 12);
      return font;
    } catch (error) {
      console.error("[pdf-download] default font candidate failed", { path, error });
      continue;
    }
  }

  return pdfDocument.embedFont(StandardFonts.Helvetica);
}
