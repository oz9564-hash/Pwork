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

export type PdfSlotRow = {
  id: string;
  label: string;
  createdAt: number;
};

export type ColumnPdf = {
  id: string;
  columnId: string;
  pdfRowId: string;
  name: string;
  /** 업로드/복사 시에만 채워지는 PDF 원본. 평소 메모리에는 메타데이터만 두고 필요할 때 Storage에서 내려받는다. */
  file?: Blob;
  status: "draft" | "ready";
  createdAt: number;
  updatedAt: number;
};

export type PdfArea = {
  id: string;
  columnPdfId: string;
  rowId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

export type FontAsset = {
  id: "active-font";
  name: string;
  file: Blob;
  updatedAt: number;
};
