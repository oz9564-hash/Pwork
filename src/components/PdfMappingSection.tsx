import { Fragment, useState } from "react";
import type { DragEvent } from "react";
import { FileDown, FileText, Pencil, Plus, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import type { PdfSlotRow, ValueColumn } from "../types";

type Props = {
  columns: ValueColumn[];
  pdfRows: PdfSlotRow[];
  /** 일괄(columnId) / 단건(`${columnId}:${pdfRowId}`) 다운로드 버튼 disabled 판정. */
  busyId?: string;
  hasAreas: (pdfRowId: string) => boolean;
  /** 이 (열 × PDF행)에 미세조정 보정이 적용돼 있는지. 버튼 색 구분에 쓴다. */
  hasAdjust: (columnId: string, pdfRowId: string) => boolean;
  onDeletePdfRow: (pdfRowId: string) => void;
  onAddPdfRow: () => void;
  onUploadPdf: (pdfRow: PdfSlotRow, file: File | undefined) => void;
  onOpenSetup: (pdfRow: PdfSlotRow, column?: ValueColumn) => void;
  onDownloadOne: (column: ValueColumn, pdfRow: PdfSlotRow) => void;
  onDownloadColumn: (column: ValueColumn) => void;
  onDownloadStarterMergedColumn: (column: ValueColumn) => void;
};

/**
 * PDF 매핑 밴드(섹션 라벨 + 열별 일괄 다운로드 행 + PDF 행들 + PDF 행 추가).
 * .sheet CSS Grid의 직접 자식이 되도록 Fragment를 반환한다(래퍼 div 금지).
 * 드롭 하이라이트(pdfDropTarget)는 순수 로컬 UI라 여기서 소유한다.
 */
export function PdfMappingSection({
  columns,
  pdfRows,
  busyId,
  hasAreas,
  hasAdjust,
  onDeletePdfRow,
  onAddPdfRow,
  onUploadPdf,
  onOpenSetup,
  onDownloadOne,
  onDownloadColumn,
  onDownloadStarterMergedColumn,
}: Props) {
  const [pdfDropTarget, setPdfDropTarget] = useState<string>();

  function handleDragOver(event: DragEvent, pdfRowId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setPdfDropTarget(pdfRowId);
  }

  function handleDragLeave(event: DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setPdfDropTarget(undefined);
  }

  function handleDrop(event: DragEvent, pdfRow: PdfSlotRow) {
    event.preventDefault();
    event.stopPropagation();
    setPdfDropTarget(undefined);
    void onUploadPdf(pdfRow, event.dataTransfer.files[0]);
  }

  return (
    <>
      <div className="sheetCell sectionLabelCell stickyCol">
        <span className="sectionBandLabel">
          <FileText size={14} />
          PDF 매핑
        </span>
      </div>
      {columns.map((column) => (
        <div className="sheetCell sectionDownloadCell" key={`${column.id}-pdf-bulk-download`}>
          <div className="columnDownloadActions">
            <button
              className="columnDownloadButton"
              type="button"
              disabled={busyId === column.id}
              onClick={() => void onDownloadColumn(column)}
            >
              {column.name} 일괄 다운로드
            </button>
            <button
              className="columnDownloadButton starterMergeDownloadButton"
              type="button"
              disabled={busyId === `${column.id}:starter-merge`}
              onClick={() => void onDownloadStarterMergedColumn(column)}
            >
              개시용 병합 다운로드
            </button>
          </div>
        </div>
      ))}
      <div className="sheetCell sectionDownloadCell" />

      {pdfRows.map((pdfRow) => {
        const rowHasAreas = hasAreas(pdfRow.id);
        return (
          <Fragment key={pdfRow.id}>
            <div className="sheetCell rowLabel stickyCol pdfRowLabel">
              <div className="pdfRowLabelTop">
                <span
                  className={pdfRow.pdf ? "pdfRowName" : "pdfRowName empty"}
                  title={pdfRow.pdf?.name ?? "PDF 미선택"}
                >
                  <FileText size={13} />
                  {pdfRow.pdf?.name ?? "PDF 미선택"}
                </span>
                <button type="button" title="PDF 행 삭제" onClick={() => void onDeletePdfRow(pdfRow.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              {pdfRow.pdf ? (
                <div className="pdfRowCommon">
                  <div className="pdfRowCommonActions">
                    <button
                      type="button"
                      className="pdfBaseAreaButton"
                      title="기준 영역 설정"
                      onClick={() => onOpenSetup(pdfRow)}
                    >
                      <Pencil size={13} />
                      기준 영역
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <label
                    className={pdfDropTarget === pdfRow.id ? "pdfUploadSlot dragging" : "pdfUploadSlot"}
                    onDragOver={(event) => handleDragOver(event, pdfRow.id)}
                    onDragEnter={(event) => handleDragOver(event, pdfRow.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(event) => handleDrop(event, pdfRow)}
                  >
                    <Upload size={15} />
                    <span>PDF 드롭</span>
                    <small>또는 클릭</small>
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(event) => void onUploadPdf(pdfRow, event.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    className="pdfBaseAreaButton"
                    disabled
                    title="먼저 PDF를 올려주세요"
                  >
                    <Pencil size={13} />
                    기준 영역
                  </button>
                </>
              )}
            </div>
            {columns.map((column) => (
              <div className="sheetCell pdfSlotCell" key={`${pdfRow.id}-${column.id}`}>
                {!pdfRow.pdf ? (
                  <span className="pdfSlotHint">왼쪽에 PDF를 올리세요</span>
                ) : !rowHasAreas ? (
                  <span className="pdfSlotHint">왼쪽에서 기준 영역을 먼저 잡으세요</span>
                ) : (
                  <div className="pdfColumnActions">
                    {(() => {
                      const tuned = hasAdjust(column.id, pdfRow.id);
                      return (
                        <button
                          type="button"
                          className={tuned ? "adjustButton tuned" : "adjustButton untuned"}
                          onClick={() => onOpenSetup(pdfRow, column)}
                        >
                          <SlidersHorizontal size={14} />
                          {tuned ? "미세조정 완료" : "미세조정 미완료"}
                        </button>
                      );
                    })()}
                    <button
                      className="pdfDownloadButton"
                      type="button"
                      title="PDF 다운로드"
                      aria-label="PDF 다운로드"
                      disabled={busyId === `${column.id}:${pdfRow.id}`}
                      onClick={() => void onDownloadOne(column, pdfRow)}
                    >
                      <FileDown size={14} />
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
        <button className="addSheetButton" type="button" onClick={() => void onAddPdfRow()}>
          <Plus size={16} />PDF 행 추가
        </button>
      </div>
      {columns.map((column) => (
        <div className="sheetCell addRowCell" key={`${column.id}-add-pdf-row`} />
      ))}
      <div className="sheetCell emptyAddColumnCell" />
    </>
  );
}
