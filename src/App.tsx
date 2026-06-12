import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent } from "react";
import type { User } from "firebase/auth";
import { FileText, LogOut } from "lucide-react";
import { PdfSetupModal } from "./components/PdfSetupModal";
import { PdfMappingSection } from "./components/PdfMappingSection";
import { SheetGrid } from "./components/SheetGrid";
import { StatusOverlays } from "./components/StatusOverlays";
import type { BusyFeedback, CellImagePreview, UploadNotice } from "./components/StatusOverlays";
import { useSheetSelection } from "./hooks/useSheetSelection";
import { useSheetData } from "./hooks/useSheetData";
import { usePdfData } from "./hooks/usePdfData";
import { SKIP_LOGIN, signInWithGoogle, signOutUser, watchAuth } from "./services/firebase";
import { repository } from "./services/storage";
import type { PdfSlotRow, ValueColumn } from "./types";

/** 기준 편집(column 없음) 또는 열 미세조정(column 있음) 모달 대상. */
type ActiveSetup = {
  pdfRow: PdfSlotRow;
  column?: ValueColumn;
};

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
  const sheetWrapRef = useRef<HTMLElement | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [activeSetup, setActiveSetup] = useState<ActiveSetup>();
  const [busyId, setBusyId] = useState<string>();
  const [busyFeedback, setBusyFeedback] = useState<BusyFeedback>();
  const [sheetZoom, setSheetZoom] = useState(1);
  const [imagePreview, setImagePreview] = useState<CellImagePreview>();
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>();
  // undefined = 인증 확인 중, null = 로그아웃 상태, User = 로그인됨
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authBusy, setAuthBusy] = useState(false);

  // 도메인 상태/영속화는 훅으로 분리한다. 토스트·블로킹 오버레이·버튼 busy는 App이 소유하고
  // 콜백으로 내려준다. 선택(useSheetSelection)은 시트 데이터를 읽으므로 그 다음에 만든다.
  const sheet = useSheetData({ notify: setUploadNotice, setBusyFeedback, setBusyId });
  const pdf = usePdfData({ notify: setUploadNotice, setBusyFeedback, setBusyId });
  const selection = useSheetSelection(sheet.rows, sheet.columns);

  useEffect(() => {
    return watchAuth(setUser);
  }, []);

  useEffect(() => {
    if (!uploadNotice) return undefined;
    // 에러는 사용자가 읽을 시간을 더 준다.
    const duration = uploadNotice.tone === "error" ? 5000 : 2200;
    const timer = window.setTimeout(() => setUploadNotice(undefined), duration);
    return () => window.clearTimeout(timer);
  }, [uploadNotice]);

  useEffect(() => {
    if (user || SKIP_LOGIN) {
      selection.clear();
      void Promise.all([sheet.load(), pdf.load()]);
      return;
    }
    // 로그아웃 시 메모리에 남은 데이터를 비운다.
    sheet.reset();
    pdf.reset();
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** 열 복제: 시트(값·이미지) 복사 후 PDF 보정까지 이어 붙인다. busy/에러 토스트는 여기서 묶는다. */
  async function duplicateColumn(source: ValueColumn) {
    setBusyId(source.id);
    setBusyFeedback({
      title: `${source.name} 열 복사 중`,
      description: "값, 이미지, PDF 설정을 복사하고 있습니다.",
    });
    try {
      const copied = await sheet.duplicateColumn(source);
      await pdf.copyAdjustsForColumn(source.id, copied);
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

  /** 행 삭제 후 그 행을 끝점으로 둔 선택을 해제한다. */
  async function deleteRow(rowId: string) {
    if (await sheet.deleteRow(rowId)) selection.clearIfRow(rowId);
  }

  /** 열 삭제 후 그 열을 끝점으로 둔 선택을 해제한다. */
  async function deleteColumn(columnId: string) {
    if (await sheet.deleteColumn(columnId)) selection.clearIfColumn(columnId);
  }

  function handleSheetPaste(event: ClipboardEvent<HTMLInputElement>, rowId: string, columnId?: string) {
    const cells = parsePastedCells(event.clipboardData.getData("text/plain"));
    if (!isMultiCellPaste(cells)) return;
    event.preventDefault();
    void (async () => {
      const range = await sheet.pasteSheetCells(rowId, columnId, cells);
      if (range) selection.setRange(range.anchor, range.focus);
    })();
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

  function getColumnWidth(columnId: string) {
    return columnWidths[columnId] ?? 280;
  }

  const pdfRowsWithFile = pdf.pdfRows.filter((pdfRow) => pdfRow.pdf).length;
  const pdfRowsReady = pdf.pdfRows.filter(
    (pdfRow) => pdfRow.pdf && pdf.areasForPdfRow(pdfRow.id).length > 0,
  ).length;

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
          <span>{sheet.rows.length}개 항목</span>
          <span>{sheet.columns.length}개 열</span>
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

      {sheet.rows.length === 0 && sheet.columns.length === 0 ? (
        <section className="emptySheet">
          <FileText size={24} />
          <span>아직 작업 표가 없습니다.</span>
          <button className="button primary" type="button" onClick={() => void sheet.createStarterSheet()}>
            기본 표 만들기
          </button>
        </section>
      ) : (
        <section
          ref={sheetWrapRef}
          className="sheetWrap"
          onCopyCapture={selection.handleCopy}
          style={{ "--sheet-zoom": sheetZoom } as CSSProperties}
        >
          <div
            className="sheet"
            style={{
              gridTemplateColumns: `${Math.round(220 * sheetZoom)}px ${sheet.columns
                .map((column) => `${Math.round(getColumnWidth(column.id) * sheetZoom)}px`)
                .join(" ")} minmax(${Math.round(160 * sheetZoom)}px, 1fr)`,
            }}
          >
            <SheetGrid
              rows={sheet.rows}
              columns={sheet.columns}
              busyId={busyId}
              selection={selection}
              onUpdateColumnName={sheet.updateColumnName}
              onDuplicateColumn={(column) => void duplicateColumn(column)}
              onDeleteColumn={(columnId) => void deleteColumn(columnId)}
              onAddColumn={() => void sheet.addColumn()}
              onAddRow={() => void sheet.addRow()}
              onUpdateRow={sheet.updateRow}
              onDeleteRow={(rowId) => void deleteRow(rowId)}
              onMoveRow={(draggedRowId, targetRowId) => void sheet.moveRow(draggedRowId, targetRowId)}
              onUpdateCell={sheet.updateCell}
              onPaste={handleSheetPaste}
              onUploadCellImage={(column, rowId, file) => void sheet.uploadCellImage(column, rowId, file)}
              onPreviewCellImage={(column, rowId) => void openCellImagePreview(column, rowId)}
              onClearCellImage={(column, rowId) => void sheet.clearCellImage(column, rowId)}
              onColumnResizeStart={(columnId, clientX) => {
                resizeRef.current = { columnId, startX: clientX, startWidth: getColumnWidth(columnId) };
              }}
            />

            <PdfMappingSection
              columns={sheet.columns}
              pdfRows={pdf.pdfRows}
              busyId={busyId}
              hasAreas={(pdfRowId) => pdf.areasForPdfRow(pdfRowId).length > 0}
              hasAdjust={(columnId, pdfRowId) => pdf.hasAdjust(columnId, pdfRowId)}
              onUpdatePdfRow={pdf.updatePdfRow}
              onDeletePdfRow={(pdfRowId) => void pdf.deletePdfRow(pdfRowId)}
              onAddPdfRow={() => void pdf.addPdfRow()}
              onUploadPdf={(pdfRow, file) => void pdf.uploadCommonPdf(pdfRow, file)}
              onOpenSetup={(pdfRow, column) => setActiveSetup({ pdfRow, column })}
              onDownloadOne={(column, pdfRow) => void pdf.downloadFilledPdf(column, pdfRow, sheet.rows)}
              onDownloadColumn={(column) => void pdf.downloadPdfColumn(column, sheet.rows)}
            />
          </div>
        </section>
      )}

      {activeSetup ? (
        <PdfSetupModal
          pdfRow={activeSetup.pdfRow}
          column={activeSetup.column}
          rows={sheet.rows}
          font={pdf.font}
          onClose={() => setActiveSetup(undefined)}
          onSaved={() => void pdf.reloadPdfData()}
        />
      ) : null}
      <StatusOverlays
        busyFeedback={busyFeedback}
        uploadNotice={uploadNotice}
        imagePreview={imagePreview}
        onCloseImagePreview={closeCellImagePreview}
      />
    </main>
  );
}
