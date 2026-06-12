export type FieldRow = {
  id: string;
  label: string;
  createdAt: number;
};

export type ValueColumn = {
  id: string;
  name: string;
  values: Record<string, string>;
  images?: Record<string, CellImageAsset>;
  createdAt: number;
  updatedAt: number;
};

export type CellImageAsset = {
  name: string;
  contentType: "image/png" | "image/jpeg";
  storagePath?: string;
  width: number;
  height: number;
  updatedAt: number;
};

/** PDF 행에 한 장 붙는 공통 PDF의 메타데이터. 실제 파일은 Storage(pdfs/{pdfRowId})에 저장된다. */
export type CommonPdf = {
  name: string;
  updatedAt: number;
};

export type PdfSlotRow = {
  id: string;
  label: string;
  createdAt: number;
  /** 이 행의 공통 PDF. 없으면 아직 업로드 전. */
  pdf?: CommonPdf;
};

/** 영역을 렌더링하는 방식. 보통은 셀 내용에서 파생되지만 명시 지정도 가능하다. */
export type PdfAreaKind = "text" | "image";

/**
 * 기준 영역. "어떤 항목(rowId)을 PDF 어디에(x/y/크기/페이지) 찍을지"의 원본 레이아웃.
 * PDF 행(공통 PDF)에 1벌만 존재하며 모든 값 열이 공유한다.
 */
export type PdfArea = {
  id: string;
  pdfRowId: string;
  rowId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  /**
   * 렌더 타입. 보통은 (영역 row × 열 셀 내용)에서 파생되므로 비워 둔다.
   * 값이 있으면 파생보다 우선한다. (하위호환: 기존 문서엔 없음)
   */
  kind?: PdfAreaKind;
};

/**
 * 열별 개별 영역 보정. 기준 영역(PdfArea) 위에 이 열에서만 덧씌운다.
 * - dx/dy: 위치 오프셋(정규화)
 * - width/height: 박스 크기 덮어쓰기(정규화). 있으면 기준 크기를 대체한다.
 * - fontSize: 글자 크기 덮어쓰기(pt). 있으면 기준 글자 크기를 대체한다.
 *
 * 모두 선택값이다(없으면 기준값 사용).
 * 기존 저장 데이터({dx, dy})와 하위호환된다.
 */
export type AreaOverride = {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  fontSize?: number;
};

/**
 * 열별 미세조정. 기준 영역 위에 (열 × PDF행) 단위로 덧씌우는 보정값.
 * - overrides: 특정 영역(areaId)만 미는 위치 보정 + 크기 덮어쓰기
 */
export type ColumnPdfAdjust = {
  id: string;
  columnId: string;
  pdfRowId: string;
  overrides: Record<string, AreaOverride>;
  updatedAt: number;
};

export type FontAsset = {
  id: "active-font";
  name: string;
  file: Blob;
  updatedAt: number;
};
