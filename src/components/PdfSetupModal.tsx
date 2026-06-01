import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Eye, Plus, Save, Trash2, X } from "lucide-react";
import { createId } from "../lib/ids";
import { localRepository } from "../services/storage";
import type { ColumnPdf, FieldRow, FontAsset, PdfArea, ValueColumn } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

/** PDF 원본 대비 화면에 렌더링하는 배율. 캔버스 viewport와 글자 크기 환산에 함께 쓰인다. */
const DISPLAY_SCALE = 1.35;
/** 새 영역을 추가할 때의 기본 글자 크기(pt). */
const DEFAULT_FONT_SIZE = 11;
/** 영역 너비 측정 시 사용하는 글꼴. 실제 PDF 출력 글꼴과 맞춰야 측정이 정확하다. */
const AREA_FONT_FAMILY = "LocalBatang, Batang, serif";

type DragState = {
  id: string;
  startClientX: number;
  startClientY: number;
  startArea: PdfArea;
};

type Props = {
  column: ValueColumn;
  pdf: ColumnPdf;
  rows: FieldRow[];
  font?: FontAsset;
  onClose: () => void;
  onSaved: (areas: PdfArea[]) => void;
};

export function PdfSetupModal({ column, pdf, rows, font, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [areas, setAreas] = useState<PdfArea[]>([]);
  const [selectedRowId, setSelectedRowId] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadPdf() {
      setLoading(true);
      const [loadedAreas, bytes] = await Promise.all([
        localRepository.getAreas(pdf.id),
        pdf.file.arrayBuffer(),
      ]);
      const loadedDocument = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;

      if (!alive) return;
      setAreas(loadedAreas);
      setPdfDocument(loadedDocument);
      setPageCount(loadedDocument.numPages);
      setSelectedRowId(rows[0]?.id ?? "");
      setLoading(false);
    }

    void loadPdf();
    return () => {
      alive = false;
    };
  }, [pdf, rows]);

  useEffect(() => {
    if (!pdfDocument) return;

    let cancelled = false;

    async function renderPage() {
      const canvas = canvasRef.current;
      if (!canvas || !pdfDocument) return;

      const loadedPage = await pdfDocument.getPage(page);
      const viewport = loadedPage.getViewport({ scale: DISPLAY_SCALE });
      const context = canvas.getContext("2d");
      if (!context || cancelled) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setSize({ width: viewport.width, height: viewport.height });

      await loadedPage.render({ canvasContext: context, viewport }).promise;
    }

    void renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, page]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = (event.clientX - drag.startClientX) / size.width;
      const dy = (event.clientY - drag.startClientY) / size.height;

      setAreas((current) =>
        current.map((area) => {
          if (area.id !== drag.id) return area;

          return {
            ...area,
            x: clamp(drag.startArea.x + dx, 0, 1 - drag.startArea.width),
            y: clamp(drag.startArea.y + dy, 0, 1 - drag.startArea.height),
          };
        }),
      );
    }

    function onPointerUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [size]);

  const normalizedAreas = useMemo(
    () => areas.map((area) => resizeAreaToText(area)),
    [areas, column.values, rows, size],
  );
  const pageAreas = useMemo(() => normalizedAreas.filter((area) => area.page === page), [normalizedAreas, page]);
  const selectedArea = areas.find((area) => area.id === selectedAreaId);
  const selectedRow = rows.find((row) => row.id === selectedRowId);
  const selectedValue = getAreaValue(selectedRowId);

  /** 항목에 입력된 값을 우선 쓰고, 없으면 항목 라벨로 폴백한다. (측정·배치 미리보기용) */
  function getAreaValue(rowId: string) {
    return column.values[rowId] || rows.find((row) => row.id === rowId)?.label || "";
  }

  /** 화면 표시용 원본 값. 값이 없으면 빈 문자열을 그대로 둔다. */
  function getDisplayValue(rowId: string) {
    return column.values[rowId] ?? "";
  }

  /** 화면 표시용 항목 라벨. 없으면 "항목"으로 폴백한다. */
  function getDisplayLabel(rowId: string) {
    return rows.find((row) => row.id === rowId)?.label ?? "항목";
  }

  function handleHoverMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (!selectedRowId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  function addAreaAt(clientX?: number, clientY?: number) {
    if (previewMode) return;
    if (!selectedRowId) return;

    const overlay = overlayRef.current;
    const rect = overlay?.getBoundingClientRect();
    const value = getAreaValue(selectedRowId);
    const width = measureAreaWidth(value, DEFAULT_FONT_SIZE, size.width);
    const height = measureAreaHeight(DEFAULT_FONT_SIZE, size.height);
    const x = rect && clientX ? (clientX - rect.left) / rect.width - width / 2 : 0.39;
    const y = rect && clientY ? (clientY - rect.top) / rect.height - height / 2 : 0.45;

    const area: PdfArea = {
      id: createId("area"),
      columnPdfId: pdf.id,
      rowId: selectedRowId,
      page,
      x: clamp(x, 0, 1 - width),
      y: clamp(y, 0, 1 - height),
      width,
      height,
      fontSize: DEFAULT_FONT_SIZE,
    };

    setAreas((current) => [...current, area]);
    setSelectedAreaId(area.id);
  }

  function startDrag(event: ReactPointerEvent, area: PdfArea) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    dragRef.current = {
      id: area.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startArea: area,
    };
  }

  function updateSelectedArea(patch: Partial<PdfArea>) {
    if (!selectedAreaId) return;
    setAreas((current) =>
      current.map((area) => {
        if (area.id !== selectedAreaId) return area;
        const next = { ...area, ...patch };
        return resizeAreaToText(next);
      }),
    );
  }

  function resizeAreaToText(area: PdfArea) {
    const value = getAreaValue(area.rowId);
    const width = measureAreaWidth(value, area.fontSize, size.width);
    const height = measureAreaHeight(area.fontSize, size.height);

    return {
      ...area,
      width,
      height,
      x: clamp(area.x, 0, 1 - width),
      y: clamp(area.y, 0, 1 - height),
    };
  }

  function removeArea(id: string) {
    setAreas((current) => current.filter((area) => area.id !== id));
    setSelectedAreaId((current) => (current === id ? "" : current));
  }

  async function save() {
    await localRepository.replaceAreas(pdf.id, normalizedAreas);
    onSaved(normalizedAreas);
    onClose();
  }

  function togglePreview() {
    setPreviewMode((current) => !current);
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <section className="modal">
        <header className="modalHeader">
          <div>
            <h2>
              {column.name} / {pdf.name}
            </h2>
            <p>왼쪽 항목을 선택한 뒤 PDF 위를 클릭하면 이 열 전용 영역이 추가됩니다.</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} title="닫기">
            <X size={20} />
          </button>
        </header>

        <div className="setupLayout">
          <aside className="fieldRail">
            <div className="railTitle">이 열의 값</div>
            <div className="fieldList">
              {rows.map((row) => (
                <button
                  className={row.id === selectedRowId ? "fieldButton active" : "fieldButton"}
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedRowId(row.id)}
                >
                  <span>{row.label || "항목 없음"}</span>
                  <strong>{column.values[row.id] || "값 없음"}</strong>
                </button>
              ))}
            </div>
            <button
              className="button primary full"
              type="button"
              disabled={!selectedRowId || previewMode}
              onClick={() => addAreaAt()}
            >
              <Plus size={16} />
              영역 추가
            </button>

            <div className="areaEditor">
              <div className="railTitle">선택 영역</div>
              {selectedArea ? (
                <>
                  <label>
                    연결 항목
                    <select
                      value={selectedArea.rowId}
                      disabled={previewMode}
                      onChange={(event) => updateSelectedArea({ rowId: event.target.value })}
                    >
                      {rows.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label || "항목 없음"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    글자 크기
                    <input
                      type="number"
                      min={6}
                      max={48}
                      value={selectedArea.fontSize}
                      disabled={previewMode}
                      onChange={(event) => updateSelectedArea({ fontSize: Number(event.target.value) })}
                    />
                  </label>
                  <button
                    className="button danger full"
                    type="button"
                    disabled={previewMode}
                    onClick={() => removeArea(selectedAreaId)}
                  >
                    <Trash2 size={16} />
                    영역 삭제
                  </button>
                </>
              ) : (
                <p>PDF 위 영역을 선택하세요.</p>
              )}
            </div>
          </aside>

          <div className="pdfStageWrap">
            <div className="pageToolbar">
              <button
                className="iconButton"
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                title="이전 페이지"
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {page} / {pageCount}
              </span>
              <button
                className="iconButton"
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                title="다음 페이지"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="pdfScroll">
              {loading ? <div className="loading">PDF 로딩 중</div> : null}
              <div className="pdfCanvasBox" style={{ width: size.width, height: size.height }}>
                <canvas ref={canvasRef} />
                {previewMode ? (
                  <PreviewAreaLayer areas={pageAreas} size={size} getValue={getDisplayValue} />
                ) : (
                  <EditAreaLayer
                    overlayRef={overlayRef}
                    areas={pageAreas}
                    size={size}
                    selectedAreaId={selectedAreaId}
                    hoverPoint={hoverPoint}
                    placementValue={selectedValue}
                    onHoverMove={handleHoverMove}
                    onHoverLeave={() => setHoverPoint(null)}
                    onAddAt={addAreaAt}
                    onStartDrag={startDrag}
                    onRemoveArea={removeArea}
                    getValue={getDisplayValue}
                    getLabel={getDisplayLabel}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <footer className="modalFooter">
          <span>
            현재 영역 {normalizedAreas.length}개
            {selectedRow ? ` · 선택 항목: ${selectedRow.label || "항목 없음"}` : ""}
          </span>
          <div>
            <button className="button secondary" type="button" disabled={normalizedAreas.length === 0} onClick={togglePreview}>
              <Eye size={16} />
              {previewMode ? "편집 보기" : "미리보기"}
            </button>
            <button className="button secondary" type="button" onClick={onClose}>
              닫기
            </button>
            <button className="button primary" type="button" disabled={normalizedAreas.length === 0} onClick={() => void save()}>
              <Save size={16} />
              저장 후 세팅 완료
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

type Size = { width: number; height: number };

/** 정규화된 영역(0~1)을 현재 캔버스 픽셀 좌표/크기로 환산한 인라인 스타일. */
function areaStyle(area: PdfArea, size: Size) {
  return {
    left: area.x * size.width,
    top: area.y * size.height,
    width: area.width * size.width,
    height: area.height * size.height,
    fontSize: area.fontSize * DISPLAY_SCALE,
  };
}

type PreviewAreaLayerProps = {
  areas: PdfArea[];
  size: Size;
  getValue: (rowId: string) => string;
};

/** 미리보기 모드: 상호작용 없이 각 영역의 값만 그대로 표시한다. */
function PreviewAreaLayer({ areas, size, getValue }: PreviewAreaLayerProps) {
  return (
    <div className="areaOverlay previewing">
      {areas.map((area) => (
        <div className="mappedArea preview" key={area.id} style={areaStyle(area, size)}>
          <span>{getValue(area.rowId)}</span>
        </div>
      ))}
    </div>
  );
}

type EditAreaLayerProps = {
  overlayRef: RefObject<HTMLDivElement | null>;
  areas: PdfArea[];
  size: Size;
  selectedAreaId: string;
  hoverPoint: { x: number; y: number } | null;
  placementValue: string;
  onHoverMove: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onHoverLeave: () => void;
  onAddAt: (clientX: number, clientY: number) => void;
  onStartDrag: (event: ReactPointerEvent, area: PdfArea) => void;
  onRemoveArea: (id: string) => void;
  getValue: (rowId: string) => string;
  getLabel: (rowId: string) => string;
};

/** 편집 모드: 클릭으로 영역 추가, 드래그 이동, 호버 배치 미리보기, 개별 삭제를 처리한다. */
function EditAreaLayer({
  overlayRef,
  areas,
  size,
  selectedAreaId,
  hoverPoint,
  placementValue,
  onHoverMove,
  onHoverLeave,
  onAddAt,
  onStartDrag,
  onRemoveArea,
  getValue,
  getLabel,
}: EditAreaLayerProps) {
  return (
    <div
      className="areaOverlay"
      ref={overlayRef}
      onMouseMove={onHoverMove}
      onMouseLeave={onHoverLeave}
      onClick={(event) => {
        if (event.target === event.currentTarget) onAddAt(event.clientX, event.clientY);
      }}
    >
      {hoverPoint && placementValue ? (
        <div
          className="placementPreview"
          style={{
            left: hoverPoint.x,
            top: hoverPoint.y,
            fontSize: DEFAULT_FONT_SIZE * DISPLAY_SCALE,
          }}
        >
          {placementValue}
        </div>
      ) : null}
      {areas.map((area) => (
        <div
          className={["mappedArea", area.id === selectedAreaId ? "selected" : ""].filter(Boolean).join(" ")}
          key={area.id}
          style={areaStyle(area, size)}
          onPointerDown={(event) => onStartDrag(event, area)}
        >
          <span>{getValue(area.rowId) || getLabel(area.rowId)}</span>
          <button
            type="button"
            className="areaDeleteButton"
            title="영역 삭제"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveArea(area.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function measureAreaWidth(text: string, fontSize: number, pageWidth: number) {
  const displayFontSize = fontSize * DISPLAY_SCALE;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context!.font = `${displayFontSize}px ${AREA_FONT_FAMILY}`;
  const measuredWidth = context?.measureText(text).width ?? text.length * displayFontSize;
  const pixelWidth = Math.max(18, measuredWidth + 14);
  return clamp(pixelWidth / pageWidth, 0.02, 0.9);
}

function measureAreaHeight(fontSize: number, pageHeight: number) {
  return clamp((fontSize * 1.55) / pageHeight, 0.001, 0.12);
}
