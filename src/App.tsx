import { Fragment, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { CellImageControl } from "./components/CellImageControl";
import { PdfSetupModal } from "./components/PdfSetupModal";
import { createId } from "./lib/ids";
import { exportPdf } from "./services/pdfExport";
import { SKIP_LOGIN, signInWithGoogle, signOutUser, watchAuth } from "./services/firebase";
import { repository } from "./services/storage";
import type { ColumnPdf, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "./types";

type ImageSize = {
  width: number;
  height: number;
};

type ActiveSetup = {
  column: ValueColumn;
  pdf: ColumnPdf;
};

const initialRows = ["?대쫫", "鍮꾨?踰덊샇"];

export function App() {
  const resizeRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [columns, setColumns] = useState<ValueColumn[]>([]);
  const [pdfRows, setPdfRows] = useState<PdfSlotRow[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [pdfs, setPdfs] = useState<ColumnPdf[]>([]);
  const [font, setFont] = useState<FontAsset>();
  const [activeSetup, setActiveSetup] = useState<ActiveSetup>();
  const [busyId, setBusyId] = useState<string>();
  // undefined = ?몄쬆 ?뺤씤 以? null = 濡쒓렇?꾩썐 ?곹깭, User = 濡쒓렇?몃맖
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
    // 濡쒓렇?꾩썐 ??硫붾え由ъ뿉 ?⑥? ?곗씠??鍮꾩슦湲?    setRows([]);
    setColumns([]);
    setPdfRows([]);
    setPdfs([]);
    setFont(undefined);
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
      name: "媛?A",
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
      name: `媛?${String.fromCharCode(65 + index)}`,
      values: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await repository.saveColumn(column);
    setColumns((current) => [...current, column]);
  }

  async function duplicateColumn(source: ValueColumn) {
    const now = Date.now();
    let copiedColumn: ValueColumn = {
      id: createId("col"),
      name: `${source.name} 蹂듭궗`,
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

  async function uploadCellImage(column: ValueColumn, rowId: string, file: File, size: ImageSize) {
    const changed = await repository.saveCellImage(column, rowId, file, {
      name: file.name,
      contentType: file.type as "image/png" | "image/jpeg",
      width: size.width,
      height: size.height,
      updatedAt: Date.now(),
    });
    setColumns((current) => current.map((item) => (item.id === column.id ? changed : item)));
  }

  async function clearCellImage(column: ValueColumn, rowId: string) {
    const changed = await repository.clearCellImage(column, rowId);
    setColumns((current) => current.map((item) => (item.id === column.id ? changed : item)));
  }

  async function deleteColumn(columnId: string) {
    await repository.deleteColumn(columnId);
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
          <h1>PDF ?띿뒪??留ㅽ띁</h1>
          <p>濡쒓렇?명븯硫??대뒓 湲곌린?먯꽌??媛숈? ?묒뾽 ?곗씠?곕? 遺덈윭?????덉뒿?덈떎.</p>
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
            <h1>PDF ?띿뒪??留ㅽ띁</h1>
            <p>媛??댁쓣 ?낅┰ ?묒뾽 ?명듃濡?愿由ы빀?덈떎.</p>
          </div>
        </div>
        <div className="workspaceSummary" aria-label="?묒뾽 ?꾪솴">
          <span>{rows.length}媛???ぉ</span>
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
          <span>?묒????묒뾽 ?쒓? ?놁뒿?덈떎.</span>
          <button className="button primary" type="button" onClick={() => void createStarterSheet()}>
            湲곕낯 ??留뚮뱾湲?          </button>
        </section>
      ) : (
        <section className="sheetWrap">
          <div
            className="sheet"
            style={{
              gridTemplateColumns: `220px ${columns.map((column) => `${getColumnWidth(column.id)}px`).join(" ")} minmax(160px, 1fr)`,
            }}
          >
            <div className="sheetCell sheetHead stickyCol">??ぉ</div>
            {columns.map((column) => (
              <div className="sheetCell sheetHead columnHead" key={column.id}>
                <input
                  value={column.name}
                  aria-label="???대쫫"
                  onChange={(event) => void updateColumnName(column.id, event.target.value)}
                />
                <div className="columnTools">
                  <button type="button" title="??蹂듭궗" onClick={() => void duplicateColumn(column)}>
                    <Copy size={15} />
                  </button>
                  <button type="button" title="????젣" onClick={() => void deleteColumn(column.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div
                  className="columnResizeHandle"
                  role="separator"
                  aria-label="???덈퉬 議곗젅"
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
                <Plus size={16} />??異붽?
              </button>
            </div>

            {rows.map((row) => (
              <Fragment key={row.id}>
                <div className="sheetCell rowLabel stickyCol" key={`${row.id}-label`}>
                  <input
                    value={row.label}
                    aria-label="항목명"
                    placeholder="??ぉ"
                    onChange={(event) => void updateRow(row.id, event.target.value)}
                  />
                  <button type="button" title="??ぉ ??젣" onClick={() => void deleteRow(row.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {columns.map((column) => (
                  <div className="sheetCell valueCell" key={`${row.id}-${column.id}`}>
                    <div className="cellValueWrap">
                      <input
                        className="cellTextInput"
                        value={column.values[row.id] ?? ""}
                        aria-label={`${column.name} ${row.label}`}
                        placeholder="媛??낅젰"
                        onChange={(event) => void updateCell(column.id, row.id, event.target.value)}
                      />
                      <CellImageControl
                        image={column.images?.[row.id]}
                        onSelect={(file, size) => uploadCellImage(column, row.id, file, size)}
                        onClear={() => clearCellImage(column, row.id)}
                      />
                    </div>
                  </div>
                ))}
                <div className="sheetCell emptyAddColumnCell" />
              </Fragment>
            ))}

            <div className="sheetCell addRowLabel stickyCol">
              <button className="addSheetButton" type="button" onClick={() => void addRow()}>
                <Plus size={16} />??異붽?
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
              <span className="sectionBandHint">열별 PDF 다운로드</span>
            </div>
            {columns.map((column) => (
              <div className="sheetCell sectionDownloadCell" key={`${column.id}-pdf-bulk-download`}>
                <button
                  className="columnDownloadButton"
                  type="button"
                  disabled={busyId === column.id}
                  onClick={() => void downloadPdfColumn(column)}
                >
                  {busyId === column.id ? (
                    <>
                      <Loader2 className="spinIcon" size={13} />
                      다운로드 중...
                    </>
                  ) : (
                    `${column.name} 일괄 다운로드`
                  )}
                </button>
              </div>
            ))}
            <div className="sheetCell sectionDownloadCell" />

            {pdfRows.map((pdfRow) => (
              <Fragment key={pdfRow.id}>
                <div className="sheetCell rowLabel stickyCol">
                  <input
                    value={pdfRow.label}
                    aria-label="PDF ???대쫫"
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
                                  title="寃곌낵 PDF"
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
                                  title="?명똿 ?댁젣"
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
                              title="PDF ??젣"
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
                          PDF ?ｊ린
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
                <Plus size={16} />PDF ??異붽?
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
    </main>
  );
}
