import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, DragEvent } from "react";
import type { User } from "firebase/auth";
import {
  Copy,
  FileDown,
  FileText,
  Loader2,
  LogOut,
  Plus,
  GripVertical,
  Pencil,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { CellImageControl } from "./components/CellImageControl";
import { PdfSetupModal } from "./components/PdfSetupModal";
import { createId } from "./lib/ids";
import { createDebouncedSaver } from "./lib/debounceSave";
import { optimizeImageFile } from "./lib/imageOptimize";
import { exportPdf } from "./services/pdfExport";
import { SKIP_LOGIN, signInWithGoogle, signOutUser, watchAuth } from "./services/firebase";
import { repository } from "./services/storage";
import type { ColumnPdfAdjust, CommonPdf, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "./types";

/** 기준 편집(column 없음) 또는 열 미세조정(column 있음) 모달 대상. */
type ActiveSetup = {
  pdfRow: PdfSlotRow;
  column?: ValueColumn;
};

type BusyFeedback = {
  title: string;
  description: string;
};

type CellImagePreview = {
  name: string;
  url: string;
};

type UploadNotice = {
  tone: "success" | "error";
  title: string;
  description: string;
};

type SheetCellPoint = {
  rowId: string;
  columnId?: string;
};

type SheetSelection = {
  anchor: SheetCellPoint;
  focus: SheetCellPoint;
};

const initialRows = ["이름", "비밀번호"];
const MIN_SHEET_ZOOM = 0.75;
const MAX_SHEET_ZOOM = 1.8;
const SHEET_ZOOM_STEP = 0.1;

function parsePastedCells(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

function isMultiCellPaste(cells: string[][]) {
  return cells.length > 1 || cells.some((row) => row.length > 1);
}

export function App() {
  const resizeRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);
  const selectingRef = useRef(false);
  const sheetWrapRef = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [columns, setColumns] = useState<ValueColumn[]>([]);
  const [pdfRows, setPdfRows] = useState<PdfSlotRow[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  // 기준 영역(모든 열 공유) + 열별 보정. PDF 파일은 PDF 행에 1장씩(pdfRow.pdf).
  const [baseAreas, setBaseAreas] = useState<PdfArea[]>([]);
  const [adjusts, setAdjusts] = useState<ColumnPdfAdjust[]>([]);
  const [font, setFont] = useState<FontAsset>();
  const [activeSetup, setActiveSetup] = useState<ActiveSetup>();
  const [busyId, setBusyId] = useState<string>();
  const [busyFeedback, setBusyFeedback] = useState<BusyFeedback>();
  const [sheetSelection, setSheetSelection] = useState<SheetSelection>();
  const [sheetZoom, setSheetZoom] = useState(1);
  const [imagePreview, setImagePreview] = useState<CellImagePreview>();
  const [pdfDropTarget, setPdfDropTarget] = useState<string>();
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>();
  const [draggingRowId, setDraggingRowId] = useState<string>();
  // undefined = 인증 확인 중, null = 로그아웃 상태, User = 로그인됨
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authBusy, setAuthBusy] = useState(false);

  // 텍스트 편집(셀 값/항목명/열 이름/PDF 행 이름)은 매 글자마다 전체 문서를 쓰지 않도록
  // 문서 단위로 디바운스한다. 즉시 전체 문서를 쓰는 다른 경로(삭제/이미지/붙여넣기 등)는
  // 최신 로컬 상태를 이미 반영하므로 해당 key의 예약을 cancel해 stale write를 막는다.
  const notifySaveError = () =>
    setUploadNotice({
      tone: "error",
      title: "저장 실패",
      description: "변경 내용을 저장하지 못했습니다. 인터넷 연결을 확인해 주세요.",
    });

  /**
   * 영속화 호출을 감싸 실패를 사용자에게 알린다. 성공 여부를 boolean으로 돌려주므로
   * 낙관적 상태 갱신을 "저장 성공 후"로 미뤄 화면과 DB의 불일치(유령 데이터)를 막는다.
   */
  async function persist(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      console.error("[persist] failed", error);
      notifySaveError();
      return false;
    }
  }
  const columnSaver = useRef(
    createDebouncedSaver<ValueColumn>((column) => repository.saveColumn(column), { onError: notifySaveError }),
  ).current;
  const rowSaver = useRef(
    createDebouncedSaver<FieldRow>((row) => repository.saveRow(row), { onError: notifySaveError }),
  ).current;
  const pdfRowSaver = useRef(
    createDebouncedSaver<PdfSlotRow>((row) => repository.savePdfRow(row), { onError: notifySaveError }),
  ).current;

  useEffect(() => {
    return watchAuth(setUser);
  }, []);

  // 언마운트/페이지 종료 직전에 남은 편집을 마저 저장한다.
  useEffect(() => {
    const flushPending = () => {
      void columnSaver.flushAll();
      void rowSaver.flushAll();
      void pdfRowSaver.flushAll();
    };
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("beforeunload", flushPending);
      flushPending();
    };
  }, [columnSaver, rowSaver, pdfRowSaver]);

  useEffect(() => {
    if (!uploadNotice) return undefined;
    // 에러는 사용자가 읽을 시간을 더 준다.
    const duration = uploadNotice.tone === "error" ? 5000 : 2200;
    const timer = window.setTimeout(() => setUploadNotice(undefined), duration);
    return () => window.clearTimeout(timer);
  }, [uploadNotice]);

  useEffect(() => {
    if (user || SKIP_LOGIN) {
      void load();
      return;
    }
    // 로그아웃 시 메모리에 남은 데이터를 비운다.
    setRows([]);
    setColumns([]);
    setPdfRows([]);
    setBaseAreas([]);
    setAdjusts([]);
    setFont(undefined);
    setSheetSelection(undefined);
  }, [user]);

  async function handleSignIn() {
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("[auth] sign in failed", error);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    await signOutUser();
  }

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const resize = resizeRef.current;
      if (!resize) return;

      const nextWidth = Math.max(240, Math.min(620, resize.startWidth + event.clientX - resize.startX));
      setColumnWidths((current) => ({ ...current, [resize.columnId]: nextWidth }));
    }

    function onPointerUp() {
      resizeRef.current = null;
      selectingRef.current = false;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const sheetWrap = sheetWrapRef.current;
    if (!sheetWrap) return;

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;

      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      setSheetZoom((current) => {
        const next = current + direction * SHEET_ZOOM_STEP;
        return Math.min(MAX_SHEET_ZOOM, Math.max(MIN_SHEET_ZOOM, Number(next.toFixed(2))));
      });
    }

    sheetWrap.addEventListener("wheel", onWheel, { passive: false });
    return () => sheetWrap.removeEventListener("wheel", onWheel);
  }, []);

  async function load() {
    const [storedRows, storedColumns, storedPdfRows, storedAreas, storedAdjusts, storedFont] = await Promise.all([
      repository.getRows(),
      repository.getColumns(),
      repository.getPdfRows(),
      repository.getAllAreas(),
      repository.getAllAdjusts(),
      repository.getFont(),
    ]);

    setRows(storedRows.sort((a, b) => a.createdAt - b.createdAt));
    setColumns(storedColumns.sort((a, b) => a.createdAt - b.createdAt));
    setPdfRows(storedPdfRows.sort((a, b) => a.createdAt - b.createdAt));
    setBaseAreas(storedAreas);
    setAdjusts(storedAdjusts);
    setFont(storedFont);
    setSheetSelection(undefined);
  }

  /** 기준 영역/보정을 다시 불러온다. 세팅·미세조정 모달 저장 후 호출. */
  async function reloadPdfData() {
    const [storedAreas, storedAdjusts] = await Promise.all([
      repository.getAllAreas(),
      repository.getAllAdjusts(),
    ]);
    setBaseAreas(storedAreas);
    setAdjusts(storedAdjusts);
  }

  function areasForPdfRow(pdfRowId: string) {
    return baseAreas.filter((area) => area.pdfRowId === pdfRowId);
  }

  function findAdjust(columnId: string, pdfRowId: string) {
    const id = repository.adjustId(columnId, pdfRowId);
    return adjusts.find((adjust) => adjust.id === id);
  }

  async function createStarterSheet() {
    const now = Date.now();
    const nextRows = initialRows.map((label, index): FieldRow => ({
      id: createId("row"),
      label,
      createdAt: now + index,
    }));
    const column: ValueColumn = {
      id: createId("col"),
      name: "값 A",
      values: {
        [nextRows[0].id]: "홍길동",
        [nextRows[1].id]: "1113",
      },
      createdAt: now + 10,
      updatedAt: now + 10,
    };

    const ok = await persist(async () => {
      for (const row of nextRows) await repository.saveRow(row);
      await repository.saveColumn(column);
    });
    if (!ok) return;
    setRows(nextRows);
    setColumns([column]);
  }

  async function addRow() {
    const row: FieldRow = {
      id: createId("row"),
      label: "",
      createdAt: Date.now(),
    };
    if (!(await persist(() => repository.saveRow(row)))) return;
    setRows((current) => [...current, row]);
  }

  async function addPdfRow() {
    const row: PdfSlotRow = {
      id: createId("pdfrow"),
      label: `PDF ${pdfRows.length + 1}`,
      createdAt: Date.now(),
    };
    if (!(await persist(() => repository.savePdfRow(row)))) return;
    setPdfRows((current) => [...current, row]);
  }

  function updatePdfRow(pdfRowId: string, label: string) {
    let changed: PdfSlotRow | undefined;
    setPdfRows((current) => {
      const next = current.map((row) => (row.id === pdfRowId ? { ...row, label } : row));
      changed = next.find((row) => row.id === pdfRowId);
      return next;
    });
    if (changed) pdfRowSaver.schedule(changed.id, changed);
  }

  async function deletePdfRow(pdfRowId: string) {
    pdfRowSaver.cancel(pdfRowId);
    if (!(await persist(() => repository.deletePdfRow(pdfRowId)))) return;
    setPdfRows((current) => current.filter((row) => row.id !== pdfRowId));
    setBaseAreas((current) => current.filter((area) => area.pdfRowId !== pdfRowId));
    setAdjusts((current) => current.filter((adjust) => adjust.pdfRowId !== pdfRowId));
  }

  function updateRow(rowId: string, label: string) {
    let changed: FieldRow | undefined;
    setRows((current) => {
      const next = current.map((row) => (row.id === rowId ? { ...row, label } : row));
      changed = next.find((row) => row.id === rowId);
      return next;
    });
    if (changed) rowSaver.schedule(changed.id, changed);
  }

  async function moveRow(draggedRowId: string, targetRowId: string) {
    if (draggedRowId === targetRowId) return;

    const fromIndex = rows.findIndex((row) => row.id === draggedRowId);
    const toIndex = rows.findIndex((row) => row.id === targetRowId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextRows = [...rows];
    const [movedRow] = nextRows.splice(fromIndex, 1);
    nextRows.splice(toIndex, 0, movedRow);
    const reorderedRows = nextRows.map((row, index) => ({ ...row, createdAt: index }));
    const changedRows = reorderedRows.filter((row, index) => row.createdAt !== rows[index]?.createdAt || row.id !== rows[index]?.id);

    setRows(reorderedRows);
    // 재정렬 결과는 즉시 기록한다. 이 행들에 대해 디바운스 예약된 라벨 저장이
    // 나중에 실행돼 createdAt(정렬 인덱스)을 되돌리지 않도록 예약을 취소한다.
    changedRows.forEach((row) => rowSaver.cancel(row.id));
    await persist(() => Promise.all(changedRows.map((row) => repository.saveRow(row))));
  }

  async function deleteRow(rowId: string) {
    // 삭제될 행의 라벨 저장 예약은 버리고, 셀 값 편집 예약은 먼저 반영한 뒤 삭제한다.
    // (repository.deleteRow가 각 열에서 이 행의 값을 제거하므로 순서가 중요하다.)
    rowSaver.cancel(rowId);
    await columnSaver.flushAll();
    if (!(await persist(() => repository.deleteRow(rowId)))) return;
    setSheetSelection((current) =>
      current?.anchor.rowId === rowId || current?.focus.rowId === rowId ? undefined : current,
    );
    setRows((current) => current.filter((row) => row.id !== rowId));
    setColumns((current) =>
      current.map((column) => {
        const { [rowId]: _removed, ...values } = column.values;
        const { [rowId]: _removedImage, ...images } = column.images ?? {};
        return { ...column, values, images };
      }),
    );
  }

  async function addColumn() {
    const index = columns.length;
    const column: ValueColumn = {
      id: createId("col"),
      name: `값 ${String.fromCharCode(65 + index)}`,
      values: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (!(await persist(() => repository.saveColumn(column)))) return;
    setColumns((current) => [...current, column]);
  }

  async function duplicateColumn(source: ValueColumn) {
    setBusyId(source.id);
    setBusyFeedback({
      title: `${source.name} 열 복사 중`,
      description: "값, 이미지, PDF 설정을 복사하고 있습니다.",
    });

    try {
      const now = Date.now();
      let copiedColumn: ValueColumn = {
        id: createId("col"),
        name: `${source.name} 복사`,
        values: { ...source.values },
        images: {},
        createdAt: now,
        updatedAt: now,
      };

      await repository.saveColumn(copiedColumn);

      for (const [rowId, image] of Object.entries(source.images ?? {})) {
        const file = await repository.getCellImageFile(source.id, rowId, image);
        copiedColumn = await repository.saveCellImage(copiedColumn, rowId, file, image);
      }

      // PDF 파일·기준 영역은 공통이라 복사하지 않는다. 이 열의 미세조정 보정만 새 열로 복제한다.
      const copiedAdjusts = adjusts
        .filter((adjust) => adjust.columnId === source.id)
        .map((adjust): ColumnPdfAdjust => ({
          ...adjust,
          id: repository.adjustId(copiedColumn.id, adjust.pdfRowId),
          columnId: copiedColumn.id,
          overrides: { ...adjust.overrides },
          updatedAt: now,
        }));
      for (const adjust of copiedAdjusts) await repository.saveAdjust(adjust);

      setColumns((current) => [...current, copiedColumn]);
      setAdjusts((current) => [...current, ...copiedAdjusts]);
    } catch (error) {
      console.error("[column-duplicate] failed", error);
      setUploadNotice({
        tone: "error",
        title: "열 복사 실패",
        description: "값/이미지/PDF를 복사하지 못했습니다. 다시 시도해 주세요.",
      });
    } finally {
      setBusyId(undefined);
      setBusyFeedback(undefined);
    }
  }

  function updateColumnName(columnId: string, name: string) {
    let changed: ValueColumn | undefined;
    setColumns((current) => {
      const next = current.map((column) =>
        column.id === columnId ? { ...column, name, updatedAt: Date.now() } : column,
      );
      changed = next.find((column) => column.id === columnId);
      return next;
    });
    if (changed) columnSaver.schedule(changed.id, changed);
  }

  function updateCell(columnId: string, rowId: string, value: string) {
    let changed: ValueColumn | undefined;
    setColumns((current) => {
      const next = current.map((column) =>
        column.id === columnId
          ? { ...column, values: { ...column.values, [rowId]: value }, updatedAt: Date.now() }
          : column,
      );
      changed = next.find((column) => column.id === columnId);
      return next;
    });
    if (changed) columnSaver.schedule(changed.id, changed);
  }

  async function pasteSheetCells(startRowId: string, startColumnId: string | undefined, cells: string[][]) {
    if (!isMultiCellPaste(cells)) return;

    const startRowIndex = rows.findIndex((row) => row.id === startRowId);
    const startColumnIndex = startColumnId ? columns.findIndex((column) => column.id === startColumnId) : -1;
    if (startRowIndex < 0 || (startColumnId && startColumnIndex < 0)) return;

    const labelPaste = startColumnIndex === -1;
    const valueWidth = Math.max(...cells.map((row) => Math.max(0, row.length - (labelPaste ? 1 : 0))));
    const targetRowCount = startRowIndex + cells.length;
    const targetColumnCount = labelPaste ? valueWidth : startColumnIndex + valueWidth;
    const now = Date.now();

    const nextRows = rows.map((row) => ({ ...row }));
    while (nextRows.length < targetRowCount) {
      nextRows.push({
        id: createId("row"),
        label: "",
        createdAt: now + nextRows.length,
      });
    }

    const nextColumns: ValueColumn[] = columns.map((column) => ({
      ...column,
      values: { ...column.values },
      ...(column.images ? { images: { ...column.images } } : {}),
    }));
    while (nextColumns.length < targetColumnCount) {
      const index = nextColumns.length;
      nextColumns.push({
        id: createId("col"),
        name: `값 ${String.fromCharCode(65 + index)}`,
        values: {},
        createdAt: now + 100 + index,
        updatedAt: now + 100 + index,
      });
    }

    const changedRows = new Set<string>();
    const changedColumnIds = new Set<string>();
    const existingRowIds = new Set(rows.map((row) => row.id));
    const existingColumnIds = new Set(columns.map((column) => column.id));

    cells.forEach((pastedRow, rowOffset) => {
      const targetRow = nextRows[startRowIndex + rowOffset];
      if (!targetRow) return;

      if (labelPaste && pastedRow[0] !== undefined) {
        targetRow.label = pastedRow[0];
        changedRows.add(targetRow.id);
      }

      pastedRow.slice(labelPaste ? 1 : 0).forEach((value, columnOffset) => {
        const targetColumn = nextColumns[(labelPaste ? 0 : startColumnIndex) + columnOffset];
        if (!targetColumn) return;
        targetColumn.values = { ...targetColumn.values, [targetRow.id]: value };
        targetColumn.updatedAt = now;
        changedColumnIds.add(targetColumn.id);
      });
    });

    setRows(nextRows);
    setColumns(nextColumns);
    setSheetSelection({
      anchor: {
        rowId: nextRows[startRowIndex].id,
        columnId: labelPaste ? undefined : nextColumns[startColumnIndex]?.id,
      },
      focus: {
        rowId: nextRows[targetRowCount - 1].id,
        columnId: targetColumnCount > 0 ? nextColumns[targetColumnCount - 1]?.id : undefined,
      },
    });
    const rowsToSave = nextRows.filter((row) => changedRows.has(row.id) || !existingRowIds.has(row.id));
    const columnsToSave = nextColumns.filter(
      (column) => changedColumnIds.has(column.id) || !existingColumnIds.has(column.id),
    );
    // 붙여넣기로 즉시 기록하는 행/열은 디바운스 예약을 취소해 나중에 stale write가 끼어들지 않게 한다.
    rowsToSave.forEach((row) => rowSaver.cancel(row.id));
    columnsToSave.forEach((column) => columnSaver.cancel(column.id));
    await Promise.all([
      ...rowsToSave.map((row) => repository.saveRow(row)),
      ...columnsToSave.map((column) => repository.saveColumn(column)),
    ]);
  }

  function handleSheetPaste(event: ClipboardEvent<HTMLInputElement>, rowId: string, columnId?: string) {
    const cells = parsePastedCells(event.clipboardData.getData("text/plain"));
    if (!isMultiCellPaste(cells)) return;
    event.preventDefault();
    void pasteSheetCells(rowId, columnId, cells);
  }

  function selectSheetCell(point: SheetCellPoint) {
    selectingRef.current = true;
    setSheetSelection({ anchor: point, focus: point });
  }

  function focusSheetCell(point: SheetCellPoint) {
    if (selectingRef.current) return;
    setSheetSelection({ anchor: point, focus: point });
  }

  function extendSheetSelection(point: SheetCellPoint) {
    if (!selectingRef.current) return;
    setSheetSelection((current) => (current ? { ...current, focus: point } : { anchor: point, focus: point }));
  }

  function getSheetPointIndexes(point: SheetCellPoint) {
    return {
      rowIndex: rows.findIndex((row) => row.id === point.rowId),
      columnIndex: point.columnId ? columns.findIndex((column) => column.id === point.columnId) : -1,
    };
  }

  function getSheetSelectionBounds() {
    if (!sheetSelection) return undefined;

    const anchor = getSheetPointIndexes(sheetSelection.anchor);
    const focus = getSheetPointIndexes(sheetSelection.focus);
    if (
      anchor.rowIndex < 0 ||
      focus.rowIndex < 0 ||
      (sheetSelection.anchor.columnId && anchor.columnIndex < 0) ||
      (sheetSelection.focus.columnId && focus.columnIndex < 0)
    ) {
      return undefined;
    }

    return {
      minRow: Math.min(anchor.rowIndex, focus.rowIndex),
      maxRow: Math.max(anchor.rowIndex, focus.rowIndex),
      minColumn: Math.min(anchor.columnIndex, focus.columnIndex),
      maxColumn: Math.max(anchor.columnIndex, focus.columnIndex),
    };
  }

  function getSheetCellCopyValue(row: FieldRow, columnIndex: number) {
    if (columnIndex < 0) return row.label;
    const column = columns[columnIndex];
    if (!column) return "";
    return column.images?.[row.id]?.name ?? column.values[row.id] ?? "";
  }

  function handleSheetCopy(event: ClipboardEvent<HTMLElement>) {
    const bounds = getSheetSelectionBounds();
    if (!bounds) return;

    const text = rows
      .slice(bounds.minRow, bounds.maxRow + 1)
      .map((row) => {
        const values: string[] = [];
        for (let columnIndex = bounds.minColumn; columnIndex <= bounds.maxColumn; columnIndex += 1) {
          values.push(getSheetCellCopyValue(row, columnIndex));
        }
        return values.join("\t");
      })
      .join("\n");

    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }

  function getSheetCellClass(rowId: string, columnId?: string) {
    const classes = ["sheetCell"];
    if (!sheetSelection) return classes.join(" ");

    const cellRowIndex = rows.findIndex((row) => row.id === rowId);
    const cellColumnIndex = columnId ? columns.findIndex((column) => column.id === columnId) : -1;
    const bounds = getSheetSelectionBounds();
    if (cellRowIndex < 0 || (columnId && cellColumnIndex < 0) || !bounds) {
      return classes.join(" ");
    }

    const selected =
      cellRowIndex >= bounds.minRow &&
      cellRowIndex <= bounds.maxRow &&
      cellColumnIndex >= bounds.minColumn &&
      cellColumnIndex <= bounds.maxColumn;
    const active = sheetSelection.anchor.rowId === rowId && sheetSelection.anchor.columnId === columnId;

    if (selected) classes.push("selectedSheetCell");
    if (active) classes.push("activeSheetCell");
    return classes.join(" ");
  }

  async function uploadCellImage(column: ValueColumn, rowId: string, file: File) {
    setBusyFeedback({
      title: "이미지 넣는 중",
      description: `${file.name} 파일을 최적화하고 저장하고 있습니다.`,
    });

    try {
      // 이 열에 디바운스 예약된 텍스트 저장이 이미지 저장 뒤 실행돼 이미지를 덮어쓰지 않도록
      // 예약을 취소한다. (saveCellImage는 최신 상태의 column으로 전체 문서를 쓴다.)
      columnSaver.cancel(column.id);
      const optimized = await optimizeImageFile(file);
      const changed = await repository.saveCellImage(column, rowId, optimized.file, {
        name: optimized.name,
        contentType: optimized.contentType,
        width: optimized.width,
        height: optimized.height,
        updatedAt: Date.now(),
      });
      setColumns((current) => current.map((item) => (item.id === column.id ? changed : item)));
      setUploadNotice({
        tone: "success",
        title: "이미지 입력 완료",
        description: `${optimized.name} 파일이 들어갔습니다.`,
      });
    } catch (error) {
      console.error("[image-upload] failed", error);
      setUploadNotice({
        tone: "error",
        title: "이미지 입력 실패",
        description: "파일을 다시 확인해 주세요.",
      });
    } finally {
      setBusyFeedback(undefined);
    }
  }

  async function clearCellImage(column: ValueColumn, rowId: string) {
    columnSaver.cancel(column.id);
    let changed: ValueColumn | undefined;
    const ok = await persist(async () => {
      changed = await repository.clearCellImage(column, rowId);
    });
    if (!ok || !changed) return;
    const next = changed;
    setColumns((current) => current.map((item) => (item.id === column.id ? next : item)));
  }

  async function openCellImagePreview(column: ValueColumn, rowId: string) {
    const image = column.images?.[rowId];
    if (!image) return;

    const url = await repository.getCellImageUrl(column.id, rowId, image);
    setImagePreview({ name: image.name || "이미지", url });
  }

  function closeCellImagePreview() {
    setImagePreview(undefined);
  }

  async function deleteColumn(columnId: string) {
    // 삭제되는 열의 디바운스 저장이 삭제 후 실행돼 문서를 되살리지 않도록 예약을 취소한다.
    columnSaver.cancel(columnId);
    if (!(await persist(() => repository.deleteColumn(columnId)))) return;
    setSheetSelection((current) =>
      current?.anchor.columnId === columnId || current?.focus.columnId === columnId ? undefined : current,
    );
    setColumns((current) => current.filter((column) => column.id !== columnId));
    setAdjusts((current) => current.filter((adjust) => adjust.columnId !== columnId));
  }

  /** PDF 행에 공통 PDF 1장을 올리거나 교체한다. */
  async function uploadCommonPdf(pdfRow: PdfSlotRow, file: File | undefined) {
    if (!file) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      setUploadNotice({
        tone: "error",
        title: "PDF 입력 실패",
        description: "PDF 파일만 넣을 수 있습니다.",
      });
      return;
    }

    setBusyFeedback({
      title: "PDF 넣는 중",
      description: `${file.name} 파일을 저장하고 있습니다.`,
    });

    try {
      pdfRowSaver.cancel(pdfRow.id);
      const pdf: CommonPdf = { name: file.name, updatedAt: Date.now() };
      const nextRow = await repository.saveCommonPdf(pdfRow, file, pdf);
      setPdfRows((current) => current.map((row) => (row.id === pdfRow.id ? nextRow : row)));
      setUploadNotice({
        tone: "success",
        title: "PDF 입력 완료",
        description: `${file.name} 파일이 들어갔습니다.`,
      });
    } catch (error) {
      console.error("[pdf-upload] failed", error);
      setUploadNotice({
        tone: "error",
        title: "PDF 입력 실패",
        description: "파일을 다시 확인해 주세요.",
      });
    } finally {
      setBusyFeedback(undefined);
    }
  }

  function handlePdfDragOver(event: DragEvent, pdfRowId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setPdfDropTarget(pdfRowId);
  }

  function handlePdfDragLeave(event: DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setPdfDropTarget(undefined);
  }

  function handlePdfDrop(event: DragEvent, pdfRow: PdfSlotRow) {
    event.preventDefault();
    event.stopPropagation();
    setPdfDropTarget(undefined);
    void uploadCommonPdf(pdfRow, event.dataTransfer.files[0]);
  }

  async function uploadFont(file: File | undefined) {
    if (!file) return;
    const nextFont: FontAsset = {
      id: "active-font",
      name: file.name,
      file,
      updatedAt: Date.now(),
    };
    if (!(await persist(() => repository.saveFont(nextFont)))) return;
    setFont(nextFont);
  }

  async function clearFont() {
    if (!(await persist(() => repository.clearFont()))) return;
    setFont(undefined);
  }

  /** 한 (열 × PDF행) 결과 PDF를 생성한다. 공통 파일 + 기준 영역 + 이 열의 보정으로 채운다. */
  async function downloadFilledPdf(column: ValueColumn, pdfRow: PdfSlotRow) {
    if (!pdfRow.pdf) return;
    const areas = areasForPdfRow(pdfRow.id);
    if (areas.length === 0) return;

    setBusyId(`${column.id}:${pdfRow.id}`);
    try {
      const file = await repository.getCommonPdfFile(pdfRow.id);
      const imageEntries = await Promise.all(
        areas
          .filter((area) => column.images?.[area.rowId])
          .map(async (area) => {
            const image = column.images?.[area.rowId];
            return [area.rowId, await repository.getCellImageFile(column.id, area.rowId, image)] as const;
          }),
      );
      await exportPdf({
        file,
        fileName: pdfRow.pdf.name,
        rows,
        column,
        areas,
        adjust: findAdjust(column.id, pdfRow.id),
        fontAsset: font,
        imageFiles: Object.fromEntries(imageEntries),
      });
    } catch (error) {
      console.error("[pdf-download] failed", error);
      setUploadNotice({
        tone: "error",
        title: "PDF 다운로드 실패",
        description: "PDF 원본을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  /** 이 열의 모든 PDF(기준 영역이 있는 PDF 행)를 한꺼번에 내려받는다. */
  async function downloadPdfColumn(column: ValueColumn) {
    const targets = pdfRows.filter((pdfRow) => pdfRow.pdf && areasForPdfRow(pdfRow.id).length > 0);
    if (targets.length === 0) return;

    setBusyId(column.id);
    setBusyFeedback({
      title: `${column.name} PDF 다운로드 중`,
      description: "완료될 때까지 기다려주세요.",
    });
    try {
      for (const pdfRow of targets) {
        const areas = areasForPdfRow(pdfRow.id);
        const file = await repository.getCommonPdfFile(pdfRow.id);
        const imageEntries = await Promise.all(
          areas
            .filter((area) => column.images?.[area.rowId])
            .map(async (area) => {
              const image = column.images?.[area.rowId];
              return [area.rowId, await repository.getCellImageFile(column.id, area.rowId, image)] as const;
            }),
        );
        await exportPdf({
          file,
          fileName: pdfRow.pdf!.name,
          rows,
          column,
          areas,
          adjust: findAdjust(column.id, pdfRow.id),
          fontAsset: font,
          imageFiles: Object.fromEntries(imageEntries),
        });
      }
    } catch (error) {
      console.error("[pdf-column-download] failed", error);
      setUploadNotice({
        tone: "error",
        title: "일괄 다운로드 실패",
        description: "일부 PDF를 만들지 못했습니다. 다시 시도해 주세요.",
      });
    } finally {
      setBusyId(undefined);
      setBusyFeedback(undefined);
    }
  }

  function getColumnWidth(columnId: string) {
    return columnWidths[columnId] ?? 280;
  }

  const pdfRowsWithFile = pdfRows.filter((pdfRow) => pdfRow.pdf).length;
  const pdfRowsReady = pdfRows.filter((pdfRow) => pdfRow.pdf && areasForPdfRow(pdfRow.id).length > 0).length;

  if (!SKIP_LOGIN && user === undefined) {
    return (
      <main className="authShell">
        <div className="authCard">
          <FileText size={28} />
          <p>불러오는 중</p>
        </div>
      </main>
    );
  }

  if (!SKIP_LOGIN && user === null) {
    return (
      <main className="authShell">
        <div className="authCard">
          <span className="brandMark" aria-hidden="true">
            <FileText size={24} />
          </span>
          <h1>PDF 텍스트 매퍼</h1>
          <p>로그인하면 어느 기기에서나 같은 작업 데이터를 불러올 수 있습니다.</p>
          <button className="button primary" type="button" disabled={authBusy} onClick={() => void handleSignIn()}>
            {authBusy ? "로그인 중" : "Google로 로그인"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            <FileText size={20} />
          </span>
          <div className="brandText">
            <h1>PDF 텍스트 매퍼</h1>
            <p>값 열을 입력해 작업 세트로 관리합니다.</p>
          </div>
        </div>
        <div className="workspaceSummary" aria-label="작업 현황">
          <span>{rows.length}개 항목</span>
          <span>{columns.length}개 열</span>
          <span>{pdfRowsReady}/{pdfRowsWithFile} PDF</span>
          {user ? (
            <button
              className="iconButton"
              type="button"
              title={`${user.email ?? "사용자"} 로그아웃`}
              onClick={() => void handleSignOut()}
            >
              <LogOut size={16} />
            </button>
          ) : null}
        </div>
      </header>

      {rows.length === 0 && columns.length === 0 ? (
        <section className="emptySheet">
          <FileText size={24} />
          <span>아직 작업 표가 없습니다.</span>
          <button className="button primary" type="button" onClick={() => void createStarterSheet()}>
            기본 표 만들기
          </button>
        </section>
      ) : (
        <section
          ref={sheetWrapRef}
          className="sheetWrap"
          onCopyCapture={handleSheetCopy}
          style={{ "--sheet-zoom": sheetZoom } as CSSProperties}
        >
          <div
            className="sheet"
            style={{
              gridTemplateColumns: `${Math.round(220 * sheetZoom)}px ${columns
                .map((column) => `${Math.round(getColumnWidth(column.id) * sheetZoom)}px`)
                .join(" ")} minmax(${Math.round(160 * sheetZoom)}px, 1fr)`,
            }}
          >
            <div className="sheetCell sheetHead stickyCol">항목</div>
            {columns.map((column) => (
              <div className="sheetCell sheetHead columnHead" key={column.id}>
                <input
                  value={column.name}
                  aria-label="열 이름"
                  onChange={(event) => void updateColumnName(column.id, event.target.value)}
                />
                <div className="columnTools">
                  <button
                    type="button"
                    title="열 복사"
                    disabled={busyId === column.id}
                    onClick={() => void duplicateColumn(column)}
                  >
                    <Copy size={15} />
                  </button>
                  <button type="button" title="열 삭제" onClick={() => void deleteColumn(column.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div
                  className="columnResizeHandle"
                  role="separator"
                  aria-label="열 너비 조절"
                  onPointerDown={(event) => {
                    resizeRef.current = {
                      columnId: column.id,
                      startX: event.clientX,
                      startWidth: getColumnWidth(column.id),
                    };
                  }}
                />
              </div>
            ))}
            <div className="sheetCell sheetHead addColumnCell">
              <button className="addSheetButton" type="button" onClick={() => void addColumn()}>
                <Plus size={16} />열 추가
              </button>
            </div>

            {rows.map((row) => (
              <Fragment key={row.id}>
                <div
                  className={`${getSheetCellClass(row.id)} rowLabel stickyCol${draggingRowId === row.id ? " draggingRow" : ""}`}
                  key={`${row.id}-label`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    selectSheetCell({ rowId: row.id });
                  }}
                  onPointerEnter={() => extendSheetSelection({ rowId: row.id })}
                  onDragOver={(event) => {
                    if (!draggingRowId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceRowId = event.dataTransfer.getData("text/plain") || draggingRowId;
                    setDraggingRowId(undefined);
                    if (sourceRowId) void moveRow(sourceRowId, row.id);
                  }}
                >
                  <button
                    className="rowDragHandle"
                    type="button"
                    draggable
                    title="행 위치 이동"
                    onPointerDown={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      setDraggingRowId(row.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", row.id);
                    }}
                    onDragEnd={() => setDraggingRowId(undefined)}
                  >
                    <GripVertical size={14} />
                  </button>
                  <input
                    value={row.label}
                    aria-label="항목명"
                    placeholder="항목"
                    onFocus={() => focusSheetCell({ rowId: row.id })}
                    onPaste={(event) => handleSheetPaste(event, row.id)}
                    onChange={(event) => void updateRow(row.id, event.target.value)}
                  />
                  <button type="button" title="항목 삭제" onClick={() => void deleteRow(row.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {columns.map((column) => {
                  const image = column.images?.[row.id];
                  return (
                    <div
                      className={`${getSheetCellClass(row.id, column.id)} valueCell`}
                      key={`${row.id}-${column.id}`}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        selectSheetCell({ rowId: row.id, columnId: column.id });
                      }}
                      onPointerEnter={() => extendSheetSelection({ rowId: row.id, columnId: column.id })}
                    >
                      <div className={image ? "cellValueWrap hasImage" : "cellValueWrap"}>
                        {image ? null : (
                          <input
                            className="cellTextInput"
                            value={column.values[row.id] ?? ""}
                            aria-label={`${column.name} ${row.label}`}
                            placeholder="값 입력"
                            onFocus={() => focusSheetCell({ rowId: row.id, columnId: column.id })}
                            onPaste={(event) => handleSheetPaste(event, row.id, column.id)}
                            onChange={(event) => void updateCell(column.id, row.id, event.target.value)}
                          />
                        )}
                        <CellImageControl
                          image={image}
                          onSelect={(file) => uploadCellImage(column, row.id, file)}
                          onPreview={() => openCellImagePreview(column, row.id)}
                          onClear={() => clearCellImage(column, row.id)}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="sheetCell emptyAddColumnCell" />
              </Fragment>
            ))}

            <div className="sheetCell addRowLabel stickyCol">
              <button className="addSheetButton" type="button" onClick={() => void addRow()}>
                <Plus size={16} />항목 추가
              </button>
            </div>
            {columns.map((column) => (
              <div className="sheetCell addRowCell" key={`${column.id}-add-row`} />
            ))}
            <div className="sheetCell emptyAddColumnCell" />

            <div className="sheetCell sectionLabelCell stickyCol">
              <span className="sectionBandLabel">
                <FileText size={14} />
                PDF 매핑
              </span>
            </div>
            {columns.map((column) => (
              <div className="sheetCell sectionDownloadCell" key={`${column.id}-pdf-bulk-download`}>
                <button
                  className="columnDownloadButton"
                  type="button"
                  disabled={busyId === column.id}
                  onClick={() => void downloadPdfColumn(column)}
                >
                  {column.name} 일괄 다운로드
                </button>
              </div>
            ))}
            <div className="sheetCell sectionDownloadCell" />

            {pdfRows.map((pdfRow) => {
              const hasAreas = areasForPdfRow(pdfRow.id).length > 0;
              return (
                <Fragment key={pdfRow.id}>
                  <div className="sheetCell rowLabel stickyCol pdfRowLabel">
                    <div className="pdfRowLabelTop">
                      <input
                        value={pdfRow.label}
                        aria-label="PDF 행 이름"
                        placeholder="PDF"
                        onChange={(event) => void updatePdfRow(pdfRow.id, event.target.value)}
                      />
                      <button type="button" title="PDF 행 삭제" onClick={() => void deletePdfRow(pdfRow.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {pdfRow.pdf ? (
                      <div className="pdfRowCommon">
                        <span className="pdfRowFileName" title={pdfRow.pdf.name}>
                          <FileText size={13} />
                          {pdfRow.pdf.name}
                        </span>
                        <div className="pdfRowCommonActions">
                          <button type="button" onClick={() => setActiveSetup({ pdfRow })}>
                            <Pencil size={13} />
                            기준 영역
                          </button>
                          <label className="pdfReplaceButton" title="PDF 교체">
                            <Upload size={13} />
                            교체
                            <input
                              type="file"
                              accept="application/pdf"
                              onChange={(event) => void uploadCommonPdf(pdfRow, event.target.files?.[0])}
                            />
                          </label>
                        </div>
                      </div>
                    ) : (
                      <label
                        className={pdfDropTarget === pdfRow.id ? "pdfUploadSlot dragging" : "pdfUploadSlot"}
                        onDragOver={(event) => handlePdfDragOver(event, pdfRow.id)}
                        onDragEnter={(event) => handlePdfDragOver(event, pdfRow.id)}
                        onDragLeave={handlePdfDragLeave}
                        onDrop={(event) => handlePdfDrop(event, pdfRow)}
                      >
                        <Upload size={15} />
                        <span>PDF 드롭</span>
                        <small>또는 클릭</small>
                        <input
                          type="file"
                          accept="application/pdf"
                          onChange={(event) => void uploadCommonPdf(pdfRow, event.target.files?.[0])}
                        />
                      </label>
                    )}
                  </div>
                  {columns.map((column) => (
                    <div className="sheetCell pdfSlotCell" key={`${pdfRow.id}-${column.id}`}>
                      {!pdfRow.pdf ? (
                        <span className="pdfSlotHint">왼쪽에 PDF를 올리세요</span>
                      ) : !hasAreas ? (
                        <span className="pdfSlotHint">왼쪽에서 기준 영역을 먼저 잡으세요</span>
                      ) : (
                        <div className="pdfColumnActions">
                          <button type="button" onClick={() => setActiveSetup({ pdfRow, column })}>
                            <SlidersHorizontal size={14} />
                            미세조정
                          </button>
                          <button
                            type="button"
                            disabled={busyId === `${column.id}:${pdfRow.id}`}
                            onClick={() => void downloadFilledPdf(column, pdfRow)}
                          >
                            <FileDown size={14} />
                            다운로드
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="sheetCell emptyAddColumnCell" />
                </Fragment>
              );
            })}

            <div className="sheetCell addRowLabel stickyCol">
              <button className="addSheetButton" type="button" onClick={() => void addPdfRow()}>
                <Plus size={16} />PDF 행 추가
              </button>
            </div>
            {columns.map((column) => (
              <div className="sheetCell addRowCell" key={`${column.id}-add-pdf-row`} />
            ))}
            <div className="sheetCell emptyAddColumnCell" />
          </div>
        </section>
      )}

      {activeSetup ? (
        <PdfSetupModal
          pdfRow={activeSetup.pdfRow}
          column={activeSetup.column}
          rows={rows}
          font={font}
          onClose={() => setActiveSetup(undefined)}
          onSaved={() => void reloadPdfData()}
        />
      ) : null}
      {imagePreview ? (
        <div className="modalBackdrop imagePreviewBackdrop" role="dialog" aria-modal="true" aria-label={imagePreview.name}>
          <div className="imagePreviewModal">
            <header className="imagePreviewHeader">
              <strong>{imagePreview.name}</strong>
              <button className="iconButton" type="button" title="닫기" onClick={closeCellImagePreview}>
                <X size={18} />
              </button>
            </header>
            <div className="imagePreviewBody">
              <img src={imagePreview.url} alt={imagePreview.name} />
            </div>
          </div>
        </div>
      ) : null}
      {busyFeedback ? (
        <div className="downloadOverlay" role="status" aria-live="polite">
          <div className="downloadDialog">
            <Loader2 className="spinIcon" size={28} />
            <strong>{busyFeedback.title}</strong>
            <span>{busyFeedback.description}</span>
          </div>
        </div>
      ) : null}
      {uploadNotice ? (
        <div className={`uploadToast ${uploadNotice.tone}`} role="status" aria-live="polite">
          <strong>{uploadNotice.title}</strong>
          <span>{uploadNotice.description}</span>
        </div>
      ) : null}
    </main>
  );
}
