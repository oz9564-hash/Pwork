import type { ColumnPdf, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "../types";

const DB_NAME = "pdf-text-mapper";
const DB_VERSION = 3;

type StoreName =
  | "fieldRows"
  | "valueColumns"
  | "pdfSlotRows"
  | "columnPdfs"
  | "columnPdfAreas"
  | "settings";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("fieldRows")) {
        db.createObjectStore("fieldRows", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("valueColumns")) {
        db.createObjectStore("valueColumns", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("pdfSlotRows")) {
        db.createObjectStore("pdfSlotRows", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("columnPdfs")) {
        const store = db.createObjectStore("columnPdfs", { keyPath: "id" });
        store.createIndex("columnId", "columnId", { unique: false });
      }

      if (!db.objectStoreNames.contains("columnPdfAreas")) {
        const store = db.createObjectStore("columnPdfAreas", { keyPath: "id" });
        store.createIndex("columnPdfId", "columnPdfId", { unique: false });
      }

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function transaction<T>(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
) {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const result = await run(tx);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function store<T>(tx: IDBTransaction, name: StoreName) {
  return tx.objectStore(name) as IDBObjectStore & {
    getAll(): IDBRequest<T[]>;
    get(key: IDBValidKey): IDBRequest<T | undefined>;
  };
}

export const localRepository = {
  async getRows() {
    return transaction("fieldRows", "readonly", async (tx) =>
      requestToPromise(store<FieldRow>(tx, "fieldRows").getAll()),
    );
  },

  async saveRow(row: FieldRow) {
    return transaction("fieldRows", "readwrite", async (tx) => {
      store<FieldRow>(tx, "fieldRows").put(row);
    });
  },

  async deleteRow(rowId: string) {
    return transaction(["fieldRows", "valueColumns", "columnPdfAreas"], "readwrite", async (tx) => {
      store<FieldRow>(tx, "fieldRows").delete(rowId);

      const columns = await requestToPromise(store<ValueColumn>(tx, "valueColumns").getAll());
      for (const column of columns) {
        const { [rowId]: _removed, ...values } = column.values;
        store<ValueColumn>(tx, "valueColumns").put({ ...column, values, updatedAt: Date.now() });
      }

      const areas = await requestToPromise(store<PdfArea>(tx, "columnPdfAreas").getAll());
      for (const area of areas) {
        if (area.rowId === rowId) store<PdfArea>(tx, "columnPdfAreas").delete(area.id);
      }
    });
  },

  async getColumns() {
    return transaction("valueColumns", "readonly", async (tx) =>
      requestToPromise(store<ValueColumn>(tx, "valueColumns").getAll()),
    );
  },

  async getPdfRows() {
    return transaction("pdfSlotRows", "readonly", async (tx) =>
      requestToPromise(store<PdfSlotRow>(tx, "pdfSlotRows").getAll()),
    );
  },

  async savePdfRow(row: PdfSlotRow) {
    return transaction("pdfSlotRows", "readwrite", async (tx) => {
      store<PdfSlotRow>(tx, "pdfSlotRows").put(row);
    });
  },

  async deletePdfRow(pdfRowId: string) {
    return transaction(["pdfSlotRows", "columnPdfs", "columnPdfAreas"], "readwrite", async (tx) => {
      store<PdfSlotRow>(tx, "pdfSlotRows").delete(pdfRowId);
      const pdfStore = store<ColumnPdf>(tx, "columnPdfs");
      const areaStore = store<PdfArea>(tx, "columnPdfAreas");
      const pdfs = await requestToPromise(pdfStore.getAll());

      for (const pdf of pdfs) {
        if (pdf.pdfRowId !== pdfRowId) continue;
        pdfStore.delete(pdf.id);
        const areas = await requestToPromise(areaStore.index("columnPdfId").getAll(pdf.id));
        for (const area of areas) areaStore.delete(area.id);
      }
    });
  },

  async saveColumn(column: ValueColumn) {
    return transaction("valueColumns", "readwrite", async (tx) => {
      store<ValueColumn>(tx, "valueColumns").put(column);
    });
  },

  async deleteColumn(columnId: string) {
    return transaction(["valueColumns", "columnPdfs", "columnPdfAreas"], "readwrite", async (tx) => {
      store<ValueColumn>(tx, "valueColumns").delete(columnId);
      const pdfStore = store<ColumnPdf>(tx, "columnPdfs");
      const areaStore = store<PdfArea>(tx, "columnPdfAreas");
      const pdfs = await requestToPromise(pdfStore.index("columnId").getAll(columnId));

      for (const pdf of pdfs) {
        pdfStore.delete(pdf.id);
        const areas = await requestToPromise(areaStore.index("columnPdfId").getAll(pdf.id));
        for (const area of areas) areaStore.delete(area.id);
      }
    });
  },

  async getColumnPdfs(columnId: string) {
    return transaction("columnPdfs", "readonly", async (tx) => {
      const index = store<ColumnPdf>(tx, "columnPdfs").index("columnId");
      return requestToPromise(index.getAll(columnId));
    });
  },

  async getAllColumnPdfs() {
    return transaction("columnPdfs", "readonly", async (tx) =>
      requestToPromise(store<ColumnPdf>(tx, "columnPdfs").getAll()),
    );
  },

  async saveColumnPdf(pdf: ColumnPdf) {
    return transaction("columnPdfs", "readwrite", async (tx) => {
      store<ColumnPdf>(tx, "columnPdfs").put(pdf);
    });
  },

  async deleteColumnPdf(columnPdfId: string) {
    return transaction(["columnPdfs", "columnPdfAreas"], "readwrite", async (tx) => {
      store<ColumnPdf>(tx, "columnPdfs").delete(columnPdfId);
      const areaStore = store<PdfArea>(tx, "columnPdfAreas");
      const areas = await requestToPromise(areaStore.index("columnPdfId").getAll(columnPdfId));
      for (const area of areas) areaStore.delete(area.id);
    });
  },

  async getAreas(columnPdfId: string) {
    return transaction("columnPdfAreas", "readonly", async (tx) => {
      const index = store<PdfArea>(tx, "columnPdfAreas").index("columnPdfId");
      return requestToPromise(index.getAll(columnPdfId));
    });
  },

  async replaceAreas(columnPdfId: string, areas: PdfArea[]) {
    return transaction("columnPdfAreas", "readwrite", async (tx) => {
      const areaStore = store<PdfArea>(tx, "columnPdfAreas");
      const existing = await requestToPromise(areaStore.index("columnPdfId").getAll(columnPdfId));
      for (const area of existing) areaStore.delete(area.id);
      for (const area of areas) areaStore.put(area);
    });
  },

  async clearAreas(columnPdfId: string) {
    return transaction("columnPdfAreas", "readwrite", async (tx) => {
      const areaStore = store<PdfArea>(tx, "columnPdfAreas");
      const areas = await requestToPromise(areaStore.index("columnPdfId").getAll(columnPdfId));
      for (const area of areas) areaStore.delete(area.id);
    });
  },

  async getFont() {
    return transaction("settings", "readonly", async (tx) =>
      requestToPromise(store<FontAsset>(tx, "settings").get("active-font")),
    );
  },

  async saveFont(font: FontAsset) {
    return transaction("settings", "readwrite", async (tx) => {
      store<FontAsset>(tx, "settings").put(font);
    });
  },

  async clearFont() {
    return transaction("settings", "readwrite", async (tx) => {
      store<FontAsset>(tx, "settings").delete("active-font");
    });
  },
};
