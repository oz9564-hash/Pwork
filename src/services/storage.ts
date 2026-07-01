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
  type DocumentReference,
} from "firebase/firestore";
import { deleteObject, getBlob, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, requireUid, storage } from "./firebase";
import { createId } from "../lib/ids";
import type {
  CellImageAsset,
  ColumnPdfAdjust,
  CommonPdf,
  FieldRow,
  FontAsset,
  PdfArea,
  PdfSlotRow,
  UserProfile,
  ValueColumn,
  Workspace,
} from "../types";

type CollectionName =
  | "fieldRows"
  | "valueColumns"
  | "pdfSlotRows"
  | "pdfAreas"
  | "columnPdfAdjusts"
  | "settings";

const FONT_KEY = "active-font";

/** 한 번에 커밋할 수 있는 batch 연산 수 상한(Firestore 500)보다 안전하게 낮춘 값. */
const BATCH_LIMIT = 450;

// ── 활성 워크스페이스 컨텍스트 ──────────────────────────────────────────
// 데이터는 categories/{category}/workspaces/{wsId}/ 아래에 있고, 같은 category 멤버가 공유한다.
// App이 워크스페이스를 열기 직전에 (category, wsId)를 지정하고, 목록/로그아웃 시 clear한다.
let activeCategory: string | null = null;
let activeWorkspaceId: string | null = null;

export function setActiveWorkspace(category: string, workspaceId: string) {
  activeCategory = category;
  activeWorkspaceId = workspaceId;
}

export function clearActiveWorkspace() {
  activeCategory = null;
  activeWorkspaceId = null;
}

function requireCategory() {
  if (activeCategory) return activeCategory;
  throw new Error("카테고리가 선택되지 않았습니다.");
}

function requireWorkspaceId() {
  if (activeWorkspaceId) return activeWorkspaceId;
  throw new Error("워크스페이스가 선택되지 않았습니다.");
}

// ── Firestore 경로 ─────────────────────────────────────────────────────
/** 사용자 프로필: userProfiles/{uid}. */
function profileDoc(uid: string) {
  return doc(db, "userProfiles", uid);
}

/** 카테고리의 워크스페이스 메타 컬렉션/문서: categories/{category}/workspaces/{wsId}. */
function workspacesCol(category: string) {
  return collection(db, "categories", category, "workspaces");
}
function workspaceDoc(category: string, wsId: string) {
  return doc(db, "categories", category, "workspaces", wsId);
}

/** 특정 워크스페이스의 데이터 컬렉션/문서. 삭제 등은 (category, wsId)를 명시해 호출한다. */
function wsDataCol(category: string, wsId: string, name: CollectionName) {
  return collection(db, "categories", category, "workspaces", wsId, name);
}
function wsDataDoc(category: string, wsId: string, name: CollectionName, id: string) {
  return doc(db, "categories", category, "workspaces", wsId, name, id);
}

/** 현재 활성 워크스페이스 기준 컬렉션/문서. repository 데이터 메서드가 쓰는 기본 경로. */
function col(name: CollectionName) {
  return wsDataCol(requireCategory(), requireWorkspaceId(), name);
}
function docRef(name: CollectionName, id: string) {
  return wsDataDoc(requireCategory(), requireWorkspaceId(), name, id);
}

// ── Storage 경로 ───────────────────────────────────────────────────────
function wsPrefix(category: string, wsId: string) {
  return `categories/${category}/workspaces/${wsId}`;
}

/** 공통 PDF 파일은 PDF 행 1개당 1개. */
function pdfFileRef(pdfRowId: string) {
  return ref(storage, `${wsPrefix(requireCategory(), requireWorkspaceId())}/pdfs/${pdfRowId}`);
}

function fontFileRef() {
  return ref(storage, `${wsPrefix(requireCategory(), requireWorkspaceId())}/font/${FONT_KEY}`);
}

function cellImagePath(columnId: string, rowId: string) {
  return `${wsPrefix(requireCategory(), requireWorkspaceId())}/images/${columnId}/${rowId}`;
}

function cellImageAssetRef(columnId: string, rowId: string, image?: CellImageAsset) {
  return ref(storage, image?.storagePath ?? cellImagePath(columnId, rowId));
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

async function deleteDocsInChunks(refs: DocumentReference[]) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const entry of refs.slice(i, i + BATCH_LIMIT)) batch.delete(entry);
    await batch.commit();
  }
}

export const repository = {
  // ── 프로필(소속 카테고리) ─────────────────────────────────────────────
  async getProfile(): Promise<UserProfile | undefined> {
    const snapshot = await getDoc(profileDoc(requireUid()));
    return snapshot.exists() ? (snapshot.data() as UserProfile) : undefined;
  },

  async saveProfile(category: string): Promise<UserProfile> {
    const profile: UserProfile = {
      uid: requireUid(),
      email: auth.currentUser?.email ?? null,
      category: category.trim(),
      createdAt: Date.now(),
    };
    await setDoc(profileDoc(profile.uid), profile, { merge: true });
    return profile;
  },

  // ── 워크스페이스(카테고리 단위 공유) ──────────────────────────────────
  async listWorkspaces(category: string): Promise<Workspace[]> {
    const snapshot = await getDocs(workspacesCol(category));
    return snapshot.docs
      .map((entry) => entry.data() as Workspace)
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async createWorkspace(category: string, name: string): Promise<Workspace> {
    const now = Date.now();
    const workspace: Workspace = {
      id: createId("ws"),
      name: name.trim() || "새 워크스페이스",
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(workspaceDoc(category, workspace.id), workspace);
    return workspace;
  },

  async renameWorkspace(category: string, wsId: string, name: string): Promise<void> {
    await setDoc(
      workspaceDoc(category, wsId),
      { name: name.trim() || "이름 없음", updatedAt: Date.now() },
      { merge: true },
    );
  },

  /** 워크스페이스 안의 모든 데이터/파일을 지운다. 같은 카테고리 멤버 전체에 영향을 주는 작업이다. */
  async deleteWorkspace(category: string, wsId: string): Promise<void> {
    // 스토리지 경로 유도를 위해 열/PDF행/폰트 메타를 먼저 읽는다.
    const [columnsSnap, pdfRowsSnap, fontMetaSnap] = await Promise.all([
      getDocs(wsDataCol(category, wsId, "valueColumns")),
      getDocs(wsDataCol(category, wsId, "pdfSlotRows")),
      getDoc(wsDataDoc(category, wsId, "settings", FONT_KEY)),
    ]);

    // Firestore 문서 삭제 (450개씩 청크)
    const names: CollectionName[] = [
      "fieldRows",
      "valueColumns",
      "pdfSlotRows",
      "pdfAreas",
      "columnPdfAdjusts",
      "settings",
    ];
    const refs: DocumentReference[] = [];
    for (const name of names) {
      const snap = await getDocs(wsDataCol(category, wsId, name));
      for (const d of snap.docs) refs.push(d.ref);
    }
    await deleteDocsInChunks(refs);

    // Storage 파일 삭제 (문서에서 경로 유도, 실패는 무시)
    const prefix = wsPrefix(category, wsId);
    const tasks: Array<Promise<unknown>> = [];
    for (const pdfEntry of pdfRowsSnap.docs) {
      const row = pdfEntry.data() as PdfSlotRow;
      if (row.pdf) tasks.push(deleteObject(ref(storage, `${prefix}/pdfs/${row.id}`)).catch(() => undefined));
    }
    for (const colEntry of columnsSnap.docs) {
      const column = colEntry.data() as ValueColumn;
      for (const [rowId, image] of Object.entries(column.images ?? {})) {
        const path = image.storagePath ?? `${prefix}/images/${column.id}/${rowId}`;
        tasks.push(deleteObject(ref(storage, path)).catch(() => undefined));
      }
    }
    if (fontMetaSnap.exists()) {
      tasks.push(deleteObject(ref(storage, `${prefix}/font/${FONT_KEY}`)).catch(() => undefined));
    }
    await Promise.all(tasks);

    // 마지막에 메타 문서 삭제 (부분 실패 시 목록에 남아 재시도 가능)
    await deleteDoc(workspaceDoc(category, wsId));
  },

  // ── 시트 데이터 ───────────────────────────────────────────────────────
  async getRows() {
    return readAll<FieldRow>("fieldRows");
  },

  async saveRow(row: FieldRow) {
    await setDoc(docRef("fieldRows", row.id), row);
  },

  async deleteRow(rowId: string) {
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
        deleteObject(cellImageAssetRef(columnId, rowId, image)).catch(() => undefined),
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
        deleteObject(cellImageAssetRef(columnId, rowId, image)).catch(() => undefined),
      ),
    );
  },

  async saveCellImage(column: ValueColumn, rowId: string, file: Blob, image: CellImageAsset) {
    const storagePath = cellImagePath(column.id, rowId);
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
    await deleteObject(cellImageAssetRef(column.id, rowId, _removed)).catch(() => undefined);
    return nextColumn;
  },

  async getCellImageFile(columnId: string, rowId: string, image?: CellImageAsset) {
    return getBlob(cellImageAssetRef(columnId, rowId, image));
  },

  async getCellImageUrl(columnId: string, rowId: string, image?: CellImageAsset) {
    return getDownloadURL(cellImageAssetRef(columnId, rowId, image));
  },

  // ── PDF 데이터 ────────────────────────────────────────────────────────
  async getPdfRows() {
    return readAll<PdfSlotRow>("pdfSlotRows");
  },

  async savePdfRow(row: PdfSlotRow) {
    await setDoc(docRef("pdfSlotRows", row.id), row);
  },

  async deletePdfRow(pdfRowId: string) {
    const [areas, adjusts] = await Promise.all([
      getDocs(query(col("pdfAreas"), where("pdfRowId", "==", pdfRowId))),
      getDocs(query(col("columnPdfAdjusts"), where("pdfRowId", "==", pdfRowId))),
    ]);

    const batch = writeBatch(db);
    batch.delete(docRef("pdfSlotRows", pdfRowId));
    for (const entry of areas.docs) batch.delete(entry.ref);
    for (const entry of adjusts.docs) batch.delete(entry.ref);
    await batch.commit();

    await deleteObject(pdfFileRef(pdfRowId)).catch(() => undefined);
  },

  /** 공통 PDF 파일을 올리고 PDF 행 메타에 파일 정보를 기록한다. */
  async saveCommonPdf(row: PdfSlotRow, file: Blob, pdf: CommonPdf) {
    await uploadBytes(pdfFileRef(row.id), file, { contentType: "application/pdf" });
    const nextRow: PdfSlotRow = { ...row, pdf };
    await setDoc(docRef("pdfSlotRows", row.id), nextRow);
    return nextRow;
  },

  /** Storage에서 공통 PDF 원본을 내려받는다. 편집/조정/출력 시점에만 호출한다. */
  async getCommonPdfFile(pdfRowId: string) {
    return getBlob(pdfFileRef(pdfRowId));
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
    const snapshot = await getDoc(docRef("settings", FONT_KEY));
    if (!snapshot.exists()) return undefined;

    const meta = snapshot.data() as Omit<FontAsset, "file">;
    const file = await getBlob(fontFileRef());
    return { ...meta, file };
  },

  async saveFont(font: FontAsset) {
    await uploadBytes(fontFileRef(), font.file);
    const { file: _file, ...meta } = font;
    await setDoc(docRef("settings", FONT_KEY), meta);
  },

  async clearFont() {
    await deleteDoc(docRef("settings", FONT_KEY));
    await deleteObject(fontFileRef()).catch(() => undefined);
  },

  /** 보정 id 생성기를 노출해 UI에서 결정적 upsert에 쓸 수 있게 한다. */
  adjustId,
};
