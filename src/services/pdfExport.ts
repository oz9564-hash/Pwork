import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import type { ColumnPdfAdjust, FieldRow, FontAsset, PdfArea, ValueColumn } from "../types";
import { resolveAreaKind } from "./pdf/areaKind";
import { resolveArea, toPageRect } from "./pdf/geometry";
import { embedUsableFont } from "./pdf/fonts";
import { getRenderer } from "./pdf/renderers";

// 좌표 계산은 geometry로 단일화됨. 기존 호출부 호환을 위해 재export.
export { effectiveAreaPosition } from "./pdf/geometry";

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

/**
 * 결과 PDF를 생성해 바이트로 돌려준다. 다운로드 없이 미리보기 렌더링에도 쓰인다.
 * exportPdf와 동일한 배치 로직을 공유하므로 미리보기 = 실제 출력이 보장된다.
 *
 * 영역마다 타입(resolveAreaKind)을 판정해 해당 렌더러에 위임한다.
 * 타입별 그리기 로직은 services/pdf/renderers/* 에 분리돼 있다.
 */
export async function renderFilledPdf({
  file,
  rows,
  column,
  areas,
  adjust,
  fontAsset,
  imageFiles = {},
}: Omit<ExportPdfParams, "fileName">): Promise<Uint8Array> {
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
    const resolvedArea = resolveArea(area, adjust);
    const rect = toPageRect(area, adjust, pageWidth, pageHeight);
    const kind = resolveAreaKind(area, column);

    // [diag] pdf-lib이 보는 페이지 크기/회전 + 이 영역의 실제 사각형(원점 좌하단).
    // 한 줄 문자열로 찍어 콘솔 잘림 방지. x+width가 pageWidth를 넘으면 페이지 밖으로 잘린다.
    console.log(
      `[diag:render] kind=${kind} page=${pageWidth.toFixed(1)}x${pageHeight.toFixed(1)} rot=${page.getRotation().angle} ` +
        `rect x=${rect.x.toFixed(1)} y=${rect.y.toFixed(1)} w=${rect.width.toFixed(1)} h=${rect.height.toFixed(1)} ` +
        `right=${(rect.x + rect.width).toFixed(1)} top=${(rect.y + rect.height).toFixed(1)} row=${area.rowId}`,
    );

    await getRenderer(kind).render({
      doc: pdfDocument,
      page,
      area,
      rect,
      fontSize: resolvedArea.fontSize,
      textFitMode: resolvedArea.textFitMode,
      column,
      row,
      font,
      imageFile: imageFiles[row.id],
    });
  }

  return pdfDocument.save();
}

export async function exportPdf(params: ExportPdfParams) {
  const output = await renderFilledPdf(params);
  const outputBuffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(outputBuffer).set(output);
  const blob = new Blob([outputBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${params.column.name}_${params.fileName.replace(/\.pdf$/i, "")}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
