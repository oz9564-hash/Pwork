import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent } from "react";
import type { User } from "firebase/auth";
import {
  Copy,
  FileDown,
  FileText,
  Loader2,
  LogOut,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { CellImageControl } from "./components/CellImageControl";
import { PdfSetupModal } from "./components/PdfSetupModal";
import { createId } from "./lib/ids";
import { optimizeImageFile } from "./lib/imageOptimize";
import { exportPdf } from "./services/pdfExport";
import { SKIP_LOGIN, signInWithGoogle, signOutUser, watchAuth } from "./services/firebase";
import { repository } from "./services/storage";
import type { ColumnPdf, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "./types";

type ActiveSetup = {
  column: ValueColumn;
  pdf: ColumnPdf;
};

type BusyFeedback = {
  title: string;
  description: string;
};

type CellImagePreview = {
  name: string;
  url: string;
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
  const [pdfs, setPdfs] = useState<ColumnPdf[]>([]);
  const [font, setFont] = useState<FontAsset>();
  const [activeSetup, setActiveSetup] = useState<ActiveSetup>();
  const [busyId, setBusyId] = useState<string>();
  const [busyFeedback, setBusyFeedback] = useState<BusyFeedback>();
  const [sheetSelection, setSheetSelection] = useState<SheetSelection>();
  const [sheetZoom, setSheetZoom] = useState(1);
  const [imagePreview, setImagePreview] = useState<CellImagePreview>();
  // undefined = 인증 확인 중, null = 로그아웃 상태, User = 로그인됨
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    return watchAuth(setUser);
  }, []);

  useEffect(() => {
    if (user || SKIP_LOGIN) {
      void load();
      return;
    }
    // 로그아웃 시 메모리에 남은 데이터를 비운다.
    setRows([]);
    setColumns([]);
    setPdfRows([]);
    setPdfs([]);
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
    const [storedRows, storedColumns, storedPdfRows, storedPdfs, storedFont] = await Promise.all([
      repository.getRows(),
      repository.getColumns(),
      repository.getPdfRows(),
      repository.getAllColumnPdfs(),
      repository.getFont(),
    ]);

    setRows(storedRows.sort((a, b) => a.createdAt - b.createdAt));
    setColumns(storedColumns.sort((a, b) => a.createdAt - b.createdAt));
    setPdfRows(storedPdfRows.sort((a, b) => a.createdAt - b.createdAt));
    setPdfs(storedPdfs.sort((a, b) => a.createdAt - b.createdAt));
    setFont(storedFont);
    setSheetSelection(undefined);
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

    for (const row of nextRows) await repository.saveRow(row);
    await repository.saveColumn(column);
    setRows(nextRows);
    setColumns([column]);
  }

  async function addRow() {
    const row: FieldRow = {
      id: createId("row"),
      label: "",
      createdAt: Date.now(),
    };
    await repository.saveRow(row);
    setRows((current) => [...current, row]);
  }

  async function addPdfRow() {
    const row: PdfSlotRow = {
      id: createId("pdfrow"),
      label: `PDF ${pdfRows.length + 1}`,
      createdAt: Date.now(),
    };
    await repository.savePdfRow(row);
    setPdfRows((current) => [...current, row]);
  }

  async function updatePdfRow(pdfRowId: string, label: string) {
    const nextRows = pdfRows.map((row) => (row.id === pdfRowId ? { ...row, label } : row));
    const changed = nextRows.find((row) => row.id === pdfRowId);
    if (!changed) return;
    setPdfRows(nextRows);
    await repository.savePdfRow(changed);
  }

  async function deletePdfRow(pdfRowId: string) {
    await repository.deletePdfRow(pdfRowId);
    setPdfRows((current) => current.filter((row) => row.id !== pdfRowId));
    setPdfs((current) => current.filter((pdf) => pdf.pdfRowId !== pdfRowId));
  }

  async function updateRow(rowId: string, label: string) {
    const nextRows = rows.map((row) => (row.id === rowId ? { ...row, label } : row));
    const changed = nextRows.find((row) => row.id === rowId);
    if (!changed) return;
    setRows(nextRows);
    await repository.saveRow(changed);
  }

  async function deleteRow(rowId: string) {
    await repository.deleteRow(rowId);
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
    setPdfs((current) => [...current]);
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
    await repository.saveColumn(column);
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

      const sourcePdfs = await repository.getColumnPdfs(source.id);
      const copiedPdfs: ColumnPdf[] = [];

      for (const sourcePdf of sourcePdfs) {
        const file = await repository.getColumnPdfFile(sourcePdf.id);
        const copiedPdf: ColumnPdf = {
          ...sourcePdf,
          id: createId("pdf"),
          columnId: copiedColumn.id,
          file,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await repository.saveColumnPdf(copiedPdf);
        copiedPdfs.push({ ...copiedPdf, file: undefined });

        const sourceAreas = await repository.getAreas(sourcePdf.id);
        const copiedAreas = sourceAreas.map((area): PdfArea => ({
          ...area,
          id: createId("area"),
          columnPdfId: copiedPdf.id,
        }));
        await repository.replaceAreas(copiedPdf.id, copiedAreas);
      }

      setColumns((current) => [...current, copiedColumn]);
      setPdfs((current) => [...current, ...copiedPdfs]);
    } catch (error) {
      console.error("[column-duplicate] failed", error);
    } finally {
      setBusyId(undefined);
      setBusyFeedback(undefined);
    }
  }

  async function updateColumnName(columnId: string, name: string) {
    const nextColumns = columns.map((column) =>
      column.id === columnId ? { ...column, name, updatedAt: Date.now() } : column,
    );
    const changed = nextColumns.find((column) => column.id === columnId);
    if (!changed) return;
    setColumns(nextColumns);
    await repository.saveColumn(changed);
  }

  async function updateCell(columnId: string, rowId: string, value: string) {
    const nextColumns = columns.map((column) =>
      column.id === columnId
        ? { ...column, values: { ...column.values, [rowId]: value }, updatedAt: Date.now() }
        : column,
    );
    const changed = nextColumns.find((column) => column.id === columnId);
    if (!changed) return;
    setColumns(nextColumns);
    await repository.saveColumn(changed);
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
    await Promise.all([
      ...nextRows.filter((row) => changedRows.has(row.id) || !existingRowIds.has(row.id)).map((row) => repository.saveRow(row)),
      ...nextColumns
        .filter((column) => changedColumnIds.has(column.id) || !existingColumnIds.has(column.id))
        .map((column) => repository.saveColumn(column)),
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

  function getSheetCellClass(rowId: string, columnId?: string) {
    const classes = ["sheetCell"];
    if (!sheetSelection) return classes.join(" ");

    const cellRowIndex = rows.findIndex((row) => row.id === rowId);
    const cellColumnIndex = columnId ? columns.findIndex((column) => column.id === columnId) : -1;
    const anchor = getSheetPointIndexes(sheetSelection.anchor);
    const focus = getSheetPointIndexes(sheetSelection.focus);
    if (
      cellRowIndex < 0 ||
      (columnId && cellColumnIndex < 0) ||
      anchor.rowIndex < 0 ||
      focus.rowIndex < 0 ||
      (sheetSelection.anchor.columnId && anchor.columnIndex < 0) ||
      (sheetSelection.focus.columnId && focus.columnIndex < 0)
    ) {
      return classes.join(" ");
    }

    const minRow = Math.min(anchor.rowIndex, focus.rowIndex);
    const maxRow = Math.max(anchor.rowIndex, focus.rowIndex);
    const minColumn = Math.min(anchor.columnIndex, focus.columnIndex);
    const maxColumn = Math.max(anchor.columnIndex, focus.columnIndex);
    const selected = cellRowIndex >= minRow && cellRowIndex <= maxRow && cellColumnIndex >= minColumn && cellColumnIndex <= maxColumn;
    const active = sheetSelection.anchor.rowId === rowId && sheetSelection.anchor.columnId === columnId;

    if (selected) classes.push("selectedSheetCell");
    if (active) classes.push("activeSheetCell");
    return classes.join(" ");
  }

  async function uploadCellImage(column: ValueColumn, rowId: string, file: File) {
    const optimized = await optimizeImageFile(file);
    const changed = await repository.saveCellImage(column, rowId, optimized.file, {
      name: optimized.name,
      contentType: optimized.contentType,
      width: optimized.width,
      height: optimized.height,
      updatedAt: Date.now(),
    });
    setColumns((current) => current.map((item) => (item.id === column.id ? changed : item)));
  }

  async function clearCellImage(column: ValueColumn, rowId: string) {
    const changed = await repository.clearCellImage(column, rowId);
    setColumns((current) => current.map((item) => (item.id === column.id ? changed : item)));
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
    await repository.deleteColumn(columnId);
    setSheetSelection((current) =>
      current?.anchor.columnId === columnId || current?.focus.columnId === columnId ? undefined : current,
    );
    setColumns((current) => current.filter((column) => column.id !== columnId));
    setPdfs((current) => current.filter((pdf) => pdf.columnId !== columnId));
  }

  async function uploadPdf(columnId: string, pdfRowId: string, file: File | undefined) {
    if (!file) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) return;

    const existing = findPdf(columnId, pdfRowId);
    if (existing) await repository.deleteColumnPdf(existing.id);

    const pdf: ColumnPdf = {
      id: createId("pdf"),
      columnId,
      pdfRowId,
      name: file.name,
      file,
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await repository.saveColumnPdf(pdf);
    setPdfs((current) => [...current.filter((item) => item.id !== existing?.id), { ...pdf, file: undefined }]);
  }

  async function uploadFont(file: File | undefined) {
    if (!file) return;
    const nextFont: FontAsset = {
      id: "active-font",
      name: file.name,
      file,
      updatedAt: Date.now(),
    };
    await repository.saveFont(nextFont);
    setFont(nextFont);
  }

  async function clearFont() {
    await repository.clearFont();
    setFont(undefined);
  }

  async function completeSetup(columnPdfId: string, areas?: PdfArea[]) {
    const pdf = pdfs.find((item) => item.id === columnPdfId);
    if (!pdf) return;

    const savedAreas = areas ?? (await repository.getAreas(columnPdfId));
    if (savedAreas.length === 0) {
      return;
    }

    const updated: ColumnPdf = { ...pdf, status: "ready", updatedAt: Date.now() };
    await repository.saveColumnPdf(updated);
    setPdfs((current) => current.map((item) => (item.id === columnPdfId ? updated : item)));
  }

  async function resetSetup(pdf: ColumnPdf) {
    const updated: ColumnPdf = { ...pdf, status: "draft", updatedAt: Date.now() };
    await repository.clearAreas(pdf.id);
    await repository.saveColumnPdf(updated);
    setPdfs((current) => current.map((item) => (item.id === pdf.id ? updated : item)));
  }

  async function deletePdf(pdf: ColumnPdf) {
    await repository.deleteColumnPdf(pdf.id);
    setPdfs((current) => current.filter((item) => item.id !== pdf.id));
  }

  async function downloadFilledPdf(column: ValueColumn, pdf: ColumnPdf) {
    setBusyId(pdf.id);
    console.log("[pdf-download] 1. click", { columnId: column.id, pdfId: pdf.id, pdfName: pdf.name });
    try {
      console.log("[pdf-download] 2. load areas and source pdf");
      const [areas, file] = await Promise.all([
        repository.getAreas(pdf.id),
        repository.getColumnPdfFile(pdf.id),
      ]);
      console.log("[pdf-download] 3. loaded source data", { areaCount: areas.length, fileSize: file.size });
      console.log("[pdf-download] 4. load mapped images");
      const imageEntries = await Promise.all(
        areas
          .filter((area) => column.images?.[area.rowId])
          .map(async (area) => {
            const image = column.images?.[area.rowId];
            return [area.rowId, await repository.getCellImageFile(column.id, area.rowId, image)] as const;
          }),
      );
      console.log("[pdf-download] 5. export pdf start", { imageCount: imageEntries.length });
      await exportPdf({ ...pdf, file }, rows, column, areas, font, Object.fromEntries(imageEntries));
      console.log("[pdf-download] 6. export pdf done");
    } catch (error) {
      console.error("[pdf-download] failed", error);
    } finally {
      console.log("[pdf-download] 7. cleanup busy state");
      setBusyId(undefined);
    }
  }

  async function downloadPdfColumn(column: ValueColumn) {
    const columnPdfs = pdfRows
      .map((pdfRow) => findPdf(column.id, pdfRow.id))
      .filter((pdf): pdf is ColumnPdf => Boolean(pdf))
      .filter((pdf) => pdf.status === "ready");

    if (columnPdfs.length === 0) {
      return;
    }

    setBusyId(column.id);
    setBusyFeedback({
      title: `${column.name} PDF 다운로드 중`,
      description: "완료될 때까지 기다려주세요.",
    });
    try {
      for (const pdf of columnPdfs) {
        const [areas, file] = await Promise.all([
          repository.getAreas(pdf.id),
          repository.getColumnPdfFile(pdf.id),
        ]);
        const imageEntries = await Promise.all(
          areas
            .filter((area) => column.images?.[area.rowId])
            .map(async (area) => {
              const image = column.images?.[area.rowId];
              return [area.rowId, await repository.getCellImageFile(column.id, area.rowId, image)] as const;
            }),
        );

        await exportPdf({ ...pdf, file }, rows, column, areas, font, Object.fromEntries(imageEntries));
      }
    } catch (error) {
      console.error("[pdf-column-download] failed", error);
    } finally {
      setBusyId(undefined);
      setBusyFeedback(undefined);
    }
  }

  function pdfsForColumn(columnId: string) {
    return pdfs.filter((pdf) => pdf.columnId === columnId);
  }

  function findPdf(columnId: string, pdfRowId: string) {
    return pdfs.find((pdf) => pdf.columnId === columnId && pdf.pdfRowId === pdfRowId);
  }

  function getColumnWidth(columnId: string) {
    return columnWidths[columnId] ?? 280;
  }

  const totalMappedPdfs = pdfs.filter((pdf) => pdf.status === "ready").length;

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
          <span>{totalMappedPdfs}/{pdfs.length} PDF</span>
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
                  className={`${getSheetCellClass(row.id)} rowLabel stickyCol`}
                  key={`${row.id}-label`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    selectSheetCell({ rowId: row.id });
                  }}
                  onPointerEnter={() => extendSheetSelection({ rowId: row.id })}
                >
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

            {pdfRows.map((pdfRow) => (
              <Fragment key={pdfRow.id}>
                <div className="sheetCell rowLabel stickyCol">
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
                {columns.map((column) => {
                  const pdf = findPdf(column.id, pdfRow.id);
                  return (
                    <div className="sheetCell pdfSlotCell" key={`${pdfRow.id}-${column.id}`}>
                      {pdf ? (
                        <div
                          className={pdf.status === "ready" ? "pdfCard ready" : "pdfCard"}
                          onClick={() => setActiveSetup({ column, pdf })}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") setActiveSetup({ column, pdf });
                          }}
                        >
                          <span>
                            {pdf.name} ({pdf.status === "ready" ? "세팅 완료" : "세팅 전"})
                          </span>
                          <div className="pdfCardActions">
                            {pdf.status === "ready" ? (
                              <>
                                <button
                                  type="button"
                                  title="결과 PDF"
                                  disabled={busyId === pdf.id}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void downloadFilledPdf(column, pdf);
                                  }}
                                >
                                  <FileDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  title="세팅 해제"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void resetSetup(pdf);
                                  }}
                                >
                                  <RotateCcw size={14} />
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              title="PDF 삭제"
                              onClick={(event) => {
                                event.stopPropagation();
                                void deletePdf(pdf);
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="pdfUploadSlot">
                          <Upload size={15} />
                          PDF 넣기
                          <input
                            type="file"
                            accept="application/pdf"
                            onChange={(event) => void uploadPdf(column.id, pdfRow.id, event.target.files?.[0])}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
                <div className="sheetCell emptyAddColumnCell" />
              </Fragment>
            ))}

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
          column={activeSetup.column}
          pdf={activeSetup.pdf}
          rows={rows}
          font={font}
          onClose={() => setActiveSetup(undefined)}
          onSaved={(areas) => void completeSetup(activeSetup.pdf.id, areas)}
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
    </main>
  );
}
