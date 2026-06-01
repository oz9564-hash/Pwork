export type FieldRow = {
  id: string;
  label: string;
  createdAt: number;
};

export type ValueColumn = {
  id: string;
  name: string;
  values: Record<string, string>;
  createdAt: number;
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
  file: Blob;
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
