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
import { deleteObject, getBlob, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, requireUid, storage } from "./firebase";
import type {
  CellImageAsset,
  ColumnPdfAdjust,
  CommonPdf,
  FieldRow,
  FontAsset,
  PdfArea,
  PdfSlotRow,
  ValueColumn,
} from "../types";

type CollectionName =
  | "fieldRows"
  | "valueColumns"
  | "pdfSlotRows"
  | "pdfAreas"
  | "columnPdfAdjusts"
  | "settings";

const FONT_KEY = "active-font";

/** 현재 사용자 컬렉션 참조. users/{uid}/{name} 아래에 데이터가 격리된다. */
function col(name: CollectionName) {
  return collection(db, "users", requireUid(), name);
}

function docRef(name: CollectionName, id: string) {
  return doc(db, "users", requireUid(), name, id);
}

/** 공통 PDF 파일은 PDF 행 1개당 1개. */
function pdfFileRef(uid: string, pdfRowId: string) {
  return ref(storage, `users/${uid}/pdfs/${pdfRowId}`);
}

function fontFileRef(uid: string) {
  return ref(storage, `users/${uid}/font/${FONT_KEY}`);
}

function cellImagePath(uid: string, columnId: string, rowId: string) {
  return `users/${uid}/images/${columnId}/${rowId}`;
}

function cellImageAssetRef(uid: string, columnId: string, rowId: string, image?: CellImageAsset) {
  return ref(storage, image?.storagePath ?? cellImagePath(uid, columnId, rowId));
}

/** 열 × PDF행 단위의 보정 문서 id. 결정적이라 upsert에 그대로 쓴다. */
function adjustId(columnId: string, pdfRowId: string) {
  return `${columnId}__${pdfRowId}`;
}

async function readAll<T>(name: CollectionName) {
  const snapshot = await getDocs(col(name));
  return snapshot.docs.map((entry) => entry.data() as T);
}

async function readWhere<T>(name: CollectionName, field: string, value: string) {
  const snapshot = await getDocs(query(col(name), where(field, "==", value)));
  return snapshot.docs.map((entry) => entry.data() as T);
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
      getDocs(col("pdfAreas")),
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

    // 이 항목을 가리키는 기준 영역도 함께 제거한다.
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

  async saveColumn(column: ValueColumn) {
    await setDoc(docRef("valueColumns", column.id), column);
  },

  async deleteColumn(columnId: string) {
    const uid = requireUid();
    const columnSnapshot = await getDoc(docRef("valueColumns", columnId));
    const column = columnSnapshot.exists() ? (columnSnapshot.data() as ValueColumn) : undefined;
    const adjusts = await getDocs(query(col("columnPdfAdjusts"), where("columnId", "==", columnId)));

    const batch = writeBatch(db);
    batch.delete(docRef("valueColumns", columnId));
    // 이 열의 미세조정 보정도 함께 제거 (파일/기준영역은 공통이라 건드리지 않는다).
    for (const entry of adjusts.docs) batch.delete(entry.ref);
    await batch.commit();

    await Promise.all(
      Object.entries(column?.images ?? {}).map(([rowId, image]) =>
        deleteObject(cellImageAssetRef(uid, columnId, rowId, image)).catch(() => undefined),
      ),
    );
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

  async getCellImageUrl(columnId: string, rowId: string, image?: CellImageAsset) {
    return getDownloadURL(cellImageAssetRef(requireUid(), columnId, rowId, image));
  },

  async getPdfRows() {
    return readAll<PdfSlotRow>("pdfSlotRows");
  },

  async savePdfRow(row: PdfSlotRow) {
    await setDoc(docRef("pdfSlotRows", row.id), row);
  },

  async deletePdfRow(pdfRowId: string) {
    const uid = requireUid();
    const [areas, adjusts] = await Promise.all([
      getDocs(query(col("pdfAreas"), where("pdfRowId", "==", pdfRowId))),
      getDocs(query(col("columnPdfAdjusts"), where("pdfRowId", "==", pdfRowId))),
    ]);

    const batch = writeBatch(db);
    batch.delete(docRef("pdfSlotRows", pdfRowId));
    for (const entry of areas.docs) batch.delete(entry.ref);
    for (const entry of adjusts.docs) batch.delete(entry.ref);
    await batch.commit();

    await deleteObject(pdfFileRef(uid, pdfRowId)).catch(() => undefined);
  },

  /** 공통 PDF 파일을 올리고 PDF 행 메타에 파일 정보를 기록한다. */
  async saveCommonPdf(row: PdfSlotRow, file: Blob, pdf: CommonPdf) {
    const uid = requireUid();
    await uploadBytes(pdfFileRef(uid, row.id), file, { contentType: "application/pdf" });
    const nextRow: PdfSlotRow = { ...row, pdf };
    await setDoc(docRef("pdfSlotRows", row.id), nextRow);
    return nextRow;
  },

  /** Storage에서 공통 PDF 원본을 내려받는다. 편집/조정/출력 시점에만 호출한다. */
  async getCommonPdfFile(pdfRowId: string) {
    return getBlob(pdfFileRef(requireUid(), pdfRowId));
  },

  async getAreas(pdfRowId: string) {
    return readWhere<PdfArea>("pdfAreas", "pdfRowId", pdfRowId);
  },

  async getAllAreas() {
    return readAll<PdfArea>("pdfAreas");
  },

  async replaceAreas(pdfRowId: string, areas: PdfArea[]) {
    const existing = await getDocs(query(col("pdfAreas"), where("pdfRowId", "==", pdfRowId)));
    const batch = writeBatch(db);
    for (const entry of existing.docs) batch.delete(entry.ref);
    for (const area of areas) batch.set(docRef("pdfAreas", area.id), area);
    await batch.commit();
  },

  async getAllAdjusts() {
    return readAll<ColumnPdfAdjust>("columnPdfAdjusts");
  },

  async saveAdjust(adjust: ColumnPdfAdjust) {
    await setDoc(docRef("columnPdfAdjusts", adjust.id), adjust);
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

  /** 보정 id 생성기를 노출해 UI에서 결정적 upsert에 쓸 수 있게 한다. */
  adjustId,
};
