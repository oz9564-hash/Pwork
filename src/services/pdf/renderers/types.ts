import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import type { FieldRow, PdfArea, PdfAreaKind, TextFitMode, ValueColumn } from "../../../types";
import type { PageRect } from "../geometry";

/** 한 영역을 그릴 때 렌더러에 전달되는 모든 컨텍스트. */
export type AreaRenderContext = {
  doc: PDFDocument;
  page: PDFPage;
  area: PdfArea;
  /** 보정까지 반영된 pdf-lib 페이지 좌표(원점 좌하단). */
  rect: PageRect;
  /** 보정까지 반영된 최대 글자 크기(pt). 실제 출력 크기는 fitText가 박스에 맞춰 계산한다. */
  fontSize: number;
  textFitMode: TextFitMode;
  column: ValueColumn;
  row: FieldRow;
  font: PDFFont;
  /** image 타입일 때 이 행의 셀 이미지 파일. */
  imageFile?: Blob;
};

/** 타입별 그리기 전략. 새 타입을 추가하려면 이 인터페이스를 구현해 레지스트리에 등록한다. */
export type AreaRenderer = {
  kind: PdfAreaKind;
  render(ctx: AreaRenderContext): Promise<void> | void;
};
