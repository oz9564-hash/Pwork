import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  FileDown,
  FileText,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { PdfSetupModal } from "./components/PdfSetupModal";
import { createId } from "./lib/ids";
import { exportPdf } from "./services/pdfExport";
import { localRepository } from "./services/storage";
import type { ColumnPdf, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "./types";

type ActiveSetup = {
  column: ValueColumn;
  pdf: ColumnPdf;
};

const initialRows = ["이름", "비밀번호"];

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
  const [message, setMessage] = useState("열마다 값과 PDF가 독립 저장됩니다.");

  useEffect(() => {
    void load();
  }, []);

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
      localRepository.getRows(),
      localRepository.getColumns(),
      localRepository.getPdfRows(),
      localRepository.getAllColumnPdfs(),
      localRepository.getFont(),
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
      name: "값 A",
      values: {
        [nextRows[0].id]: "홍길동",
        [nextRows[1].id]: "1113",
      },
      createdAt: now + 10,
      updatedAt: now + 10,
    };

    for (const row of nextRows) await localRepository.saveRow(row);
    await localRepository.saveColumn(column);
    setRows(nextRows);
    setColumns([column]);
    setMessage("기본 표를 만들었습니다.");
  }

  async function addRow() {
    const row: FieldRow = {
      id: createId("row"),
      label: "",
      createdAt: Date.now(),
    };
    await localRepository.saveRow(row);
    setRows((current) => [...current, row]);
  }

  async function addPdfRow() {
    const row: PdfSlotRow = {
      id: createId("pdfrow"),
      label: `PDF ${pdfRows.length + 1}`,
      createdAt: Date.now(),
    };
    await localRepository.savePdfRow(row);
    setPdfRows((current) => [...current, row]);
  }

  async function updatePdfRow(pdfRowId: string, label: string) {
    const nextRows = pdfRows.map((row) => (row.id === pdfRowId ? { ...row, label } : row));
    const changed = nextRows.find((row) => row.id === pdfRowId);
    if (!changed) return;
    setPdfRows(nextRows);
    await localRepository.savePdfRow(changed);
  }

  async function deletePdfRow(pdfRowId: string) {
    await localRepository.deletePdfRow(pdfRowId);
    setPdfRows((current) => current.filter((row) => row.id !== pdfRowId));
    setPdfs((current) => current.filter((pdf) => pdf.pdfRowId !== pdfRowId));
  }

  async function updateRow(rowId: string, label: string) {
    const nextRows = rows.map((row) => (row.id === rowId ? { ...row, label } : row));
    const changed = nextRows.find((row) => row.id === rowId);
    if (!changed) return;
    setRows(nextRows);
    await localRepository.saveRow(changed);
  }

  async function deleteRow(rowId: string) {
    await localRepository.deleteRow(rowId);
    setRows((current) => current.filter((row) => row.id !== rowId));
    setColumns((current) =>
      current.map((column) => {
        const { [rowId]: _removed, ...values } = column.values;
        return { ...column, values };
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
    await localRepository.saveColumn(column);
    setColumns((current) => [...current, column]);
  }

  async function duplicateColumn(source: ValueColumn) {
    const now = Date.now();
    const copiedColumn: ValueColumn = {
      id: createId("col"),
      name: `${source.name} 복사`,
      values: { ...source.values },
      createdAt: now,
      updatedAt: now,
    };

    await localRepository.saveColumn(copiedColumn);

    const sourcePdfs = await localRepository.getColumnPdfs(source.id);
    const copiedPdfs: ColumnPdf[] = [];

    for (const sourcePdf of sourcePdfs) {
      const copiedPdf: ColumnPdf = {
        ...sourcePdf,
        id: createId("pdf"),
        columnId: copiedColumn.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await localRepository.saveColumnPdf(copiedPdf);
      copiedPdfs.push(copiedPdf);

      const sourceAreas = await localRepository.getAreas(sourcePdf.id);
      const copiedAreas = sourceAreas.map((area): PdfArea => ({
        ...area,
        id: createId("area"),
        columnPdfId: copiedPdf.id,
      }));
      await localRepository.replaceAreas(copiedPdf.id, copiedAreas);
    }

    setColumns((current) => [...current, copiedColumn]);
    setPdfs((current) => [...current, ...copiedPdfs]);
    setMessage(`${source.name} 열을 통째로 복사했습니다.`);
  }

  async function updateColumnName(columnId: string, name: string) {
    const nextColumns = columns.map((column) =>
      column.id === columnId ? { ...column, name, updatedAt: Date.now() } : column,
    );
    const changed = nextColumns.find((column) => column.id === columnId);
    if (!changed) return;
    setColumns(nextColumns);
    await localRepository.saveColumn(changed);
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
    await localRepository.saveColumn(changed);
  }

  async function deleteColumn(columnId: string) {
    await localRepository.deleteColumn(columnId);
    setColumns((current) => current.filter((column) => column.id !== columnId));
    setPdfs((current) => current.filter((pdf) => pdf.columnId !== columnId));
    setMessage("열을 삭제했습니다.");
  }

  async function uploadPdf(columnId: string, pdfRowId: string, file: File | undefined) {
    if (!file) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) return;

    const existing = findPdf(columnId, pdfRowId);
    if (existing) await localRepository.deleteColumnPdf(existing.id);

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

    await localRepository.saveColumnPdf(pdf);
    setPdfs((current) => [...current.filter((item) => item.id !== existing?.id), pdf]);
    setMessage("PDF 셀에 파일을 넣었습니다.");
  }

  async function uploadFont(file: File | undefined) {
    if (!file) return;
    const nextFont: FontAsset = {
      id: "active-font",
      name: file.name,
      file,
      updatedAt: Date.now(),
    };
    await localRepository.saveFont(nextFont);
    setFont(nextFont);
    setMessage("한글 출력 폰트를 저장했습니다.");
  }

  async function clearFont() {
    await localRepository.clearFont();
    setFont(undefined);
    setMessage("폰트 설정을 해제했습니다.");
  }

  async function completeSetup(columnPdfId: string, areas?: PdfArea[]) {
    const pdf = pdfs.find((item) => item.id === columnPdfId);
    if (!pdf) return;

    const savedAreas = areas ?? (await localRepository.getAreas(columnPdfId));
    if (savedAreas.length === 0) {
      setMessage("영역이 없어서 세팅 완료로 바꿀 수 없습니다.");
      return;
    }

    const updated: ColumnPdf = { ...pdf, status: "ready", updatedAt: Date.now() };
    await localRepository.saveColumnPdf(updated);
    setPdfs((current) => current.map((item) => (item.id === columnPdfId ? updated : item)));
    setMessage(`${pdf.name} 세팅을 완료했습니다.`);
  }

  async function resetSetup(pdf: ColumnPdf) {
    const updated: ColumnPdf = { ...pdf, status: "draft", updatedAt: Date.now() };
    await localRepository.clearAreas(pdf.id);
    await localRepository.saveColumnPdf(updated);
    setPdfs((current) => current.map((item) => (item.id === pdf.id ? updated : item)));
    setMessage(`${pdf.name} 세팅을 해제했습니다.`);
  }

  async function deletePdf(pdf: ColumnPdf) {
    await localRepository.deleteColumnPdf(pdf.id);
    setPdfs((current) => current.filter((item) => item.id !== pdf.id));
    setMessage(`${pdf.name} PDF를 삭제했습니다.`);
  }

  async function downloadFilledPdf(column: ValueColumn, pdf: ColumnPdf) {
    setBusyId(pdf.id);
    try {
      const areas = await localRepository.getAreas(pdf.id);
      await exportPdf(pdf, rows, column, areas, font);
      setMessage(`${column.name} / ${pdf.name} 결과 PDF를 생성했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF 생성에 실패했습니다.");
    } finally {
      setBusyId(undefined);
    }
  }

  const hasKorean = useMemo(
    () => columns.some((column) => Object.values(column.values).some((value) => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value))),
    [columns],
  );

  function pdfsForColumn(columnId: string) {
    return pdfs.filter((pdf) => pdf.columnId === columnId);
  }

  function findPdf(columnId: string, pdfRowId: string) {
    return pdfs.find((pdf) => pdf.columnId === columnId && pdf.pdfRowId === pdfRowId);
  }

  function getColumnWidth(columnId: string) {
    return columnWidths[columnId] ?? 280;
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <h1>PDF 텍스트 매퍼</h1>
          <p>각 열을 독립 작업 세트로 관리합니다.</p>
        </div>
        <div className="topActions">
          <button className="button secondary" type="button" onClick={() => void addRow()}>
            <Plus size={16} />
            항목
          </button>
          <button className="button secondary" type="button" onClick={() => void addColumn()}>
            <Plus size={16} />값 열
          </button>
          <label className="button secondary">
            <Upload size={16} />
            폰트
            <input
              type="file"
              accept=".ttf,.otf,font/ttf,font/otf"
              onChange={(event) => void uploadFont(event.target.files?.[0])}
            />
          </label>
          {font ? (
            <button className="button ghost" type="button" onClick={() => void clearFont()}>
              <RotateCcw size={16} />
              폰트 해제
            </button>
          ) : null}
        </div>
      </header>

      <section className="notice">
        <span>{message}</span>
        {hasKorean && !font ? <strong>한글 출력 기본 폰트: 휴먼명조 우선, 없으면 바탕</strong> : null}
      </section>

      {rows.length === 0 && columns.length === 0 ? (
        <section className="emptySheet">
          <FileText size={24} />
          <span>엑셀형 작업 표가 없습니다.</span>
          <button className="button primary" type="button" onClick={() => void createStarterSheet()}>
            기본 표 만들기
          </button>
        </section>
      ) : (
        <section className="sheetWrap">
          <div
            className="sheet"
            style={{
              gridTemplateColumns: `220px ${columns.map((column) => `${getColumnWidth(column.id)}px`).join(" ")} 150px`,
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
                  <button type="button" title="열 복사" onClick={() => void duplicateColumn(column)}>
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
                <div className="sheetCell rowLabel stickyCol" key={`${row.id}-label`}>
                  <input
                    value={row.label}
                    aria-label="항목명"
                    placeholder="항목"
                    onChange={(event) => void updateRow(row.id, event.target.value)}
                  />
                  <button type="button" title="항목 삭제" onClick={() => void deleteRow(row.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {columns.map((column) => (
                  <div className="sheetCell valueCell" key={`${row.id}-${column.id}`}>
                    <input
                      value={column.values[row.id] ?? ""}
                      aria-label={`${column.name} ${row.label}`}
                      placeholder="값 입력"
                      onChange={(event) => void updateCell(column.id, row.id, event.target.value)}
                    />
                  </div>
                ))}
                <div className="sheetCell emptyAddColumnCell" />
              </Fragment>
            ))}

            <div className="sheetCell addRowLabel stickyCol">
              <button className="addSheetButton" type="button" onClick={() => void addRow()}>
                <Plus size={16} />행 추가
              </button>
            </div>
            {columns.map((column) => (
              <div className="sheetCell addRowCell" key={`${column.id}-add-row`} />
            ))}
            <div className="sheetCell emptyAddColumnCell" />

            <div className="sheetCell pdfLabel stickyCol">PDF</div>
            {columns.map((column) => (
              <div className="sheetCell pdfSectionHead" key={`${column.id}-pdf-head`}>
                {column.name} PDF
              </div>
            ))}
            <div className="sheetCell emptyAddColumnCell" />

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
    </main>
  );
}
