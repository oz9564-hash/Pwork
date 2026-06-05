import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, getBlob, ref, uploadBytes } from "firebase/storage";
import { db, requireUid, storage } from "./firebase";
import type { CellImageAsset, ColumnPdf, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "../types";

type CollectionName =
  | "fieldRows"
  | "valueColumns"
  | "pdfSlotRows"
  | "columnPdfs"
  | "columnPdfAreas"
  | "settings";

const FONT_KEY = "active-font";

/** 현재 사용자 컬렉션 참조. users/{uid}/{name} 아래에 데이터가 격리된다. */
function col(name: CollectionName) {
  return collection(db, "users", requireUid(), name);
}

function docRef(name: CollectionName, id: string) {
  return doc(db, "users", requireUid(), name, id);
}

function pdfFileRef(uid: string, columnPdfId: string) {
  return ref(storage, `users/${uid}/pdfs/${columnPdfId}`);
}

function fontFileRef(uid: string) {
  return ref(storage, `users/${uid}/font/${FONT_KEY}`);
}

function cellImagePath(uid: string, columnId: string, rowId: string) {
  return `users/${uid}/images/${columnId}/${rowId}`;
}

function cellImageRef(uid: string, columnId: string, rowId: string) {
  return ref(storage, cellImagePath(uid, columnId, rowId));
}

function cellImageAssetRef(uid: string, columnId: string, rowId: string, image?: CellImageAsset) {
  return ref(storage, image?.storagePath ?? cellImagePath(uid, columnId, rowId));
}

async function readAll<T>(name: CollectionName) {
  const snapshot = await getDocs(col(name));
  return snapshot.docs.map((entry) => entry.data() as T);
}

async function readWhere<T>(name: CollectionName, field: string, value: string) {
  const snapshot = await getDocs(query(col(name), where(field, "==", value)));
  return snapshot.docs.map((entry) => entry.data() as T);
}

/** Firestore에는 Blob을 못 넣으므로 메타데이터만 직렬화한다. 파일은 Storage에 따로 저장한다. */
function pdfMeta(pdf: ColumnPdf): Omit<ColumnPdf, "file"> {
  const { file: _file, ...meta } = pdf;
  return meta;
}

export const repository = {
  async getRows() {
    return readAll<FieldRow>("fieldRows");
  },

  async saveRow(row: FieldRow) {
    await setDoc(docRef("fieldRows", row.id), row);
  },

  async deleteRow(rowId: string) {
    const uid = requireUid();
    const [columns, areas] = await Promise.all([
      getDocs(col("valueColumns")),
      getDocs(col("columnPdfAreas")),
    ]);
    const removedImages: Array<{ columnId: string; image: CellImageAsset }> = [];

    const batch = writeBatch(db);
    batch.delete(docRef("fieldRows", rowId));

    for (const entry of columns.docs) {
      const column = entry.data() as ValueColumn;
      const { [rowId]: _removed, ...values } = column.values;
      const { [rowId]: removedImage, ...images } = column.images ?? {};
      if (removedImage) removedImages.push({ columnId: column.id, image: removedImage });
      if (rowId in column.values || removedImage) {
        batch.update(entry.ref, { values, images, updatedAt: Date.now() });
      }
    }

    for (const entry of areas.docs) {
      if ((entry.data() as PdfArea).rowId === rowId) batch.delete(entry.ref);
    }

    await batch.commit();
    await Promise.all(
      removedImages.map(({ columnId, image }) =>
        deleteObject(cellImageAssetRef(uid, columnId, rowId, image)).catch(() => undefined),
      ),
    );
  },

  async getColumns() {
    return readAll<ValueColumn>("valueColumns");
  },

  async getPdfRows() {
    return readAll<PdfSlotRow>("pdfSlotRows");
  },

  async savePdfRow(row: PdfSlotRow) {
    await setDoc(docRef("pdfSlotRows", row.id), row);
  },

  async deletePdfRow(pdfRowId: string) {
    const uid = requireUid();
    const [pdfs, areas] = await Promise.all([
      getDocs(col("columnPdfs")),
      getDocs(col("columnPdfAreas")),
    ]);

    const removedPdfIds = pdfs.docs
      .map((entry) => entry.data() as ColumnPdf)
      .filter((pdf) => pdf.pdfRowId === pdfRowId)
      .map((pdf) => pdf.id);

    const batch = writeBatch(db);
    batch.delete(docRef("pdfSlotRows", pdfRowId));
    for (const entry of pdfs.docs) {
      if ((entry.data() as ColumnPdf).pdfRowId === pdfRowId) batch.delete(entry.ref);
    }
    for (const entry of areas.docs) {
      if (removedPdfIds.includes((entry.data() as PdfArea).columnPdfId)) batch.delete(entry.ref);
    }
    await batch.commit();

    await Promise.all(
      removedPdfIds.map((id) => deleteObject(pdfFileRef(uid, id)).catch(() => undefined)),
    );
  },

  async saveColumn(column: ValueColumn) {
    await setDoc(docRef("valueColumns", column.id), column);
  },

  async deleteColumn(columnId: string) {
    const uid = requireUid();
    const columnSnapshot = await getDoc(docRef("valueColumns", columnId));
    const column = columnSnapshot.exists() ? (columnSnapshot.data() as ValueColumn) : undefined;
    const [pdfs, areas] = await Promise.all([
      getDocs(query(col("columnPdfs"), where("columnId", "==", columnId))),
      getDocs(col("columnPdfAreas")),
    ]);

    const removedPdfIds = pdfs.docs.map((entry) => (entry.data() as ColumnPdf).id);

    const batch = writeBatch(db);
    batch.delete(docRef("valueColumns", columnId));
    for (const entry of pdfs.docs) batch.delete(entry.ref);
    for (const entry of areas.docs) {
      if (removedPdfIds.includes((entry.data() as PdfArea).columnPdfId)) batch.delete(entry.ref);
    }
    await batch.commit();

    await Promise.all(
      removedPdfIds.map((id) => deleteObject(pdfFileRef(uid, id)).catch(() => undefined)),
    );
    await Promise.all(
      Object.entries(column?.images ?? {}).map(([rowId, image]) =>
        deleteObject(cellImageAssetRef(uid, columnId, rowId, image)).catch(() => undefined),
      ),
    );
  },

  async getColumnPdfs(columnId: string) {
    return readWhere<ColumnPdf>("columnPdfs", "columnId", columnId);
  },

  async getAllColumnPdfs() {
    return readAll<ColumnPdf>("columnPdfs");
  },

  async saveColumnPdf(pdf: ColumnPdf) {
    if (pdf.file) {
      await uploadBytes(pdfFileRef(requireUid(), pdf.id), pdf.file, {
        contentType: "application/pdf",
      });
    }
    await setDoc(docRef("columnPdfs", pdf.id), pdfMeta(pdf));
  },

  async saveCellImage(column: ValueColumn, rowId: string, file: Blob, image: CellImageAsset) {
    const uid = requireUid();
    const storagePath = cellImagePath(uid, column.id, rowId);
    const nextImage: CellImageAsset = { ...image, storagePath };
    const nextColumn: ValueColumn = {
      ...column,
      images: { ...(column.images ?? {}), [rowId]: nextImage },
      updatedAt: Date.now(),
    };
    await uploadBytes(ref(storage, storagePath), file, {
      contentType: image.contentType,
    });
    await setDoc(docRef("valueColumns", column.id), nextColumn);
    return nextColumn;
  },

  async clearCellImage(column: ValueColumn, rowId: string) {
    const { [rowId]: _removed, ...images } = column.images ?? {};
    const nextColumn: ValueColumn = {
      ...column,
      images,
      updatedAt: Date.now(),
    };
    await setDoc(docRef("valueColumns", column.id), nextColumn);
    await deleteObject(cellImageAssetRef(requireUid(), column.id, rowId, _removed)).catch(() => undefined);
    return nextColumn;
  },

  async getCellImageFile(columnId: string, rowId: string, image?: CellImageAsset) {
    return getBlob(cellImageAssetRef(requireUid(), columnId, rowId, image));
  },

  async deleteColumnPdf(columnPdfId: string) {
    const uid = requireUid();
    const areas = await getDocs(
      query(col("columnPdfAreas"), where("columnPdfId", "==", columnPdfId)),
    );

    const batch = writeBatch(db);
    batch.delete(docRef("columnPdfs", columnPdfId));
    for (const entry of areas.docs) batch.delete(entry.ref);
    await batch.commit();

    await deleteObject(pdfFileRef(uid, columnPdfId)).catch(() => undefined);
  },

  /** Storage에서 PDF 원본을 내려받는다. 편집 모달과 결과 PDF 생성 시점에만 호출한다. */
  async getColumnPdfFile(columnPdfId: string) {
    return getBlob(pdfFileRef(requireUid(), columnPdfId));
  },

  async getAreas(columnPdfId: string) {
    return readWhere<PdfArea>("columnPdfAreas", "columnPdfId", columnPdfId);
  },

  async replaceAreas(columnPdfId: string, areas: PdfArea[]) {
    const existing = await getDocs(
      query(col("columnPdfAreas"), where("columnPdfId", "==", columnPdfId)),
    );

    const batch = writeBatch(db);
    for (const entry of existing.docs) batch.delete(entry.ref);
    for (const area of areas) batch.set(docRef("columnPdfAreas", area.id), area);
    await batch.commit();
  },

  async clearAreas(columnPdfId: string) {
    const existing = await getDocs(
      query(col("columnPdfAreas"), where("columnPdfId", "==", columnPdfId)),
    );
    const batch = writeBatch(db);
    for (const entry of existing.docs) batch.delete(entry.ref);
    await batch.commit();
  },

  async getFont(): Promise<FontAsset | undefined> {
    const uid = requireUid();
    const snapshot = await getDoc(doc(db, "users", uid, "settings", FONT_KEY));
    if (!snapshot.exists()) return undefined;

    const meta = snapshot.data() as Omit<FontAsset, "file">;
    const file = await getBlob(fontFileRef(uid));
    return { ...meta, file };
  },

  async saveFont(font: FontAsset) {
    const uid = requireUid();
    await uploadBytes(fontFileRef(uid), font.file);
    const { file: _file, ...meta } = font;
    await setDoc(doc(db, "users", uid, "settings", FONT_KEY), meta);
  },

  async clearFont() {
    const uid = requireUid();
    await deleteDoc(doc(db, "users", uid, "settings", FONT_KEY));
    await deleteObject(fontFileRef(uid)).catch(() => undefined);
  },
};
