import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Eye, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { createId } from "../lib/ids";
import { repository } from "../services/storage";
import { renderFilledPdf } from "../services/pdfExport";
import { resolveAreaKind } from "../services/pdf/areaKind";
import { resolveArea } from "../services/pdf/geometry";
import { LINE_HEIGHT } from "../services/pdf/textLayout";
import type { AreaOverride, ColumnPdfAdjust, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

/** PDF 원본 대비 화면에 렌더링하는 배율. */
const DISPLAY_SCALE = 1.35;
const DEFAULT_FONT_SIZE = 11;
/** 오버레이/측정용 폰트. 출력과 같은 폰트(ActivePdfFont→DefaultPdfFont=human-myeongjo)를 써서
 *  사용자 폰트 로드 전/없을 때도 측정·줄바꿈이 출력과 일치하게 한다. */
const AREA_FONT_FAMILY = '"ActivePdfFont", "DefaultPdfFont", serif';
/** 오버레이에서 출력 폰트를 로드해 등록하는 font-family 이름. */
const ACTIVE_FONT_FAMILY = "ActivePdfFont";

type DragState = {
  id: string;
  /** move=영역/보정 이동, resize=영역 박스 크기 조절(base 모드 전용). */
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  /** move: 시작 위치(base=area.x/y, adjust=override dx/dy). resize: 시작 width/height. */
  startX: number;
  startY: number;
};

/** 리사이즈 최소 크기(정규화). */
const MIN_AREA_WIDTH = 0.02;
const MIN_AREA_HEIGHT = 0.01;

type Props = {
  pdfRow: PdfSlotRow;
  rows: FieldRow[];
  font?: FontAsset;
  /** 미세조정 대상 열. 있으면 adjust 모드, 없으면 기준(base) 편집 모드. */
  column?: ValueColumn;
  onClose: () => void;
  /** base 모드: 기준 영역 저장 완료 / adjust 모드: 보정 저장 완료 */
  onSaved: () => void;
};

const EMPTY_ADJUST = (columnId: string, pdfRowId: string): ColumnPdfAdjust => ({
  id: repository.adjustId(columnId, pdfRowId),
  columnId,
  pdfRowId,
  overrides: {},
  updatedAt: Date.now(),
});

export function PdfSetupModal({ pdfRow, rows, font, column, onClose, onSaved }: Props) {
  const isAdjust = Boolean(column);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [areas, setAreas] = useState<PdfArea[]>([]);
  const [adjust, setAdjust] = useState<ColumnPdfAdjust>(() =>
    EMPTY_ADJUST(column?.id ?? "", pdfRow.id),
  );
  const [selectedRowId, setSelectedRowId] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [imageBlobs, setImageBlobs] = useState<Record<string, Blob>>({});
  const [fileBlob, setFileBlob] = useState<Blob>();
  // 모달은 수정(편집) 상태로 시작한다. 미리보기는 「미리보기」 버튼으로 진입한다.
  // base 모드는 항상 편집 상태.
  const [editing, setEditing] = useState(true);
  // 미리보기 모드(adjust && !editing)에서는 실제 결과 PDF를 생성해 보여준다.
  const [previewDoc, setPreviewDoc] = useState<PDFDocumentProxy>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const canEdit = !isAdjust || editing;
  const showPreview = isAdjust && !editing;
  const activeDoc = showPreview ? previewDoc : pdfDocument;

  const firstRowId = rows[0]?.id ?? "";

  useEffect(() => {
    let alive = true;
    let loadedDocument: PDFDocumentProxy | undefined;

    async function loadPdf() {
      try {
        setLoading(true);
        setError("");
        const [loadedAreas, file, loadedAdjusts] = await Promise.all([
          repository.getAreas(pdfRow.id),
          repository.getCommonPdfFile(pdfRow.id),
          isAdjust ? repository.getAllAdjusts() : Promise.resolve([]),
        ]);
        const bytes = await file.arrayBuffer();
        loadedDocument = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;

        if (!alive) return;
        setFileBlob(file);
        setAreas(loadedAreas);
        if (isAdjust && column) {
          const id = repository.adjustId(column.id, pdfRow.id);
          const found = loadedAdjusts.find((entry) => entry.id === id);
          setAdjust(found ?? EMPTY_ADJUST(column.id, pdfRow.id));
        }
        setPdfDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
        setSelectedRowId(firstRowId);
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : "PDF load failed.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void loadPdf();
    return () => {
      alive = false;
      void loadedDocument?.destroy();
    };
  }, [pdfRow.id, firstRowId, isAdjust, column]);

  // 편집/기준 모드는 원본 문서를, 미리보기 모드는 생성된 결과 문서를 캔버스에 그린다.
  useEffect(() => {
    if (!activeDoc) return;
    let cancelled = false;

    async function renderPage() {
      const canvas = canvasRef.current;
      if (!canvas || !activeDoc) return;

      const loadedPage = await activeDoc.getPage(page);
      const viewport = loadedPage.getViewport({ scale: DISPLAY_SCALE });
      const context = canvas.getContext("2d");
      if (!context || cancelled) return;

      // [diag] pdf.js가 보는 페이지(편집=원본 / 미리보기=결과PDF). DISPLAY_SCALE=1.35 반영된 viewport.
      // view=[x0,y0,x1,y1](미회전 PDF 단위). pageExport의 [diag:render](pdf-lib getSize)와 비교.
      console.log("[diag:page] pdf.js viewport", {
        mode: showPreview ? "preview" : "edit",
        rotation: loadedPage.rotate,
        view: loadedPage.view,
        viewportW: Number(viewport.width.toFixed(1)),
        viewportH: Number(viewport.height.toFixed(1)),
        displayScale: DISPLAY_SCALE,
      });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setSize({ width: viewport.width, height: viewport.height });

      await loadedPage.render({ canvasContext: context, viewport }).promise;
    }

    void renderPage();
    return () => {
      cancelled = true;
    };
  }, [activeDoc, page]);

  // 미리보기 진입 시 실제 결과 PDF를 생성해 pdf.js 문서로 만든다(= 다운로드와 동일한 출력).
  useEffect(() => {
    if (!showPreview || !column || !fileBlob) {
      setPreviewDoc(undefined);
      return;
    }
    let alive = true;
    let builtDoc: PDFDocumentProxy | undefined;

    async function buildPreview() {
      try {
        setPreviewBusy(true);
        const output = await renderFilledPdf({
          file: fileBlob!,
          rows,
          column: column!,
          areas,
          adjust,
          fontAsset: font,
          imageFiles: imageBlobs,
        });
        builtDoc = await pdfjsLib.getDocument({ data: new Uint8Array(output) }).promise;
        if (!alive) {
          void builtDoc.destroy();
          return;
        }
        setPreviewDoc(builtDoc);
      } catch (previewError) {
        console.error("[pdf-preview] failed", previewError);
      } finally {
        if (alive) setPreviewBusy(false);
      }
    }

    void buildPreview();
    return () => {
      alive = false;
      void builtDoc?.destroy();
    };
  }, [showPreview, fileBlob, areas, adjust, font, imageBlobs, rows, column]);

  // 드래그: base 모드는 기준 영역을, adjust 모드는 해당 영역의 개별 보정을 움직인다.
  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = (event.clientX - drag.startClientX) / size.width;
      const dy = (event.clientY - drag.startClientY) / size.height;

      if (drag.mode === "resize") {
        // 좌상단 고정, width/height만 조절.
        if (isAdjust) {
          // 이 열에서만 적용되는 크기 덮어쓰기(다른 필드는 병합으로 보존).
          patchOverride(drag.id, {
            width: clamp(drag.startX + dx, MIN_AREA_WIDTH, 1),
            height: clamp(drag.startY + dy, MIN_AREA_HEIGHT, 1),
          });
        } else {
          // base 모드: 모든 열이 공유하는 기준 크기.
          setAreas((current) =>
            current.map((area) =>
              area.id === drag.id
                ? {
                    ...area,
                    width: clamp(drag.startX + dx, MIN_AREA_WIDTH, 1 - area.x),
                    height: clamp(drag.startY + dy, MIN_AREA_HEIGHT, 1 - area.y),
                  }
                : area,
            ),
          );
        }
        return;
      }

      if (isAdjust) {
        // 위치만 갱신, width/height 등은 병합으로 보존(이동했다고 크기가 초기화되면 안 됨).
        patchOverride(drag.id, { dx: drag.startX + dx, dy: drag.startY + dy });
      } else {
        setAreas((current) =>
          current.map((area) => {
            if (area.id !== drag.id) return area;
            return {
              ...area,
              x: clamp(drag.startX + dx, 0, 1 - area.width),
              y: clamp(drag.startY + dy, 0, 1 - area.height),
            };
          }),
        );
      }
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
  }, [size, isAdjust]);

  // 방향키 미세 이동. 영역 선택 시 그 영역(base=좌표, adjust=개별보정), 미선택 시 adjust 전체 오프셋.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const base = deltas[event.key];
      if (!base) return;
      if (isAdjust && !editing) return; // 미리보기 상태에서는 움직이지 않는다.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const ndx = (base[0] * step) / size.width;
      const ndy = (base[1] * step) / size.height;

      if (isAdjust) {
        if (selectedAreaId) {
          setAdjust((current) => {
            const prev = current.overrides[selectedAreaId] ?? {};
            return {
              ...current,
              overrides: {
                ...current.overrides,
                [selectedAreaId]: { ...prev, dx: (prev.dx ?? 0) + ndx, dy: (prev.dy ?? 0) + ndy },
              },
            };
          });
        }
      } else if (selectedAreaId) {
        setAreas((current) =>
          current.map((area) =>
            area.id === selectedAreaId
              ? {
                  ...area,
                  x: clamp(area.x + ndx, 0, 1 - area.width),
                  y: clamp(area.y + ndy, 0, 1 - area.height),
                }
              : area,
          ),
        );
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [size, isAdjust, selectedAreaId, editing]);

  // adjust 모드: 이 열 셀 이미지 미리보기 URL 로드
  useEffect(() => {
    if (!column) return;
    let alive = true;
    const urls: string[] = [];

    async function loadImages() {
      const entries = await Promise.all(
        Object.entries(column?.images ?? {}).map(async ([rowId, image]) => {
          try {
            const file = await repository.getCellImageFile(column!.id, rowId, image);
            const url = URL.createObjectURL(file);
            urls.push(url);
            return [rowId, { url, file }] as const;
          } catch {
            return undefined;
          }
        }),
      );
      if (!alive) return;
      const valid = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
      setImageUrls(Object.fromEntries(valid.map(([rowId, value]) => [rowId, value.url])));
      setImageBlobs(Object.fromEntries(valid.map(([rowId, value]) => [rowId, value.file])));
    }

    void loadImages();
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [column]);

  // 오버레이 텍스트를 출력과 "같은 폰트"로 그린다. (업로드 폰트 우선, 없으면 기본 human-myeongjo)
  // 폰트가 같아야 글자 폭·줄바꿈 위치가 미리보기(실제 출력)와 일치한다.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    let face: FontFace | undefined;

    async function loadActiveFont() {
      try {
        let src: string;
        if (font) {
          objectUrl = URL.createObjectURL(font.file);
          src = `url(${objectUrl})`;
        } else {
          src = `url(${import.meta.env.BASE_URL}fonts/human-myeongjo.ttf)`;
        }
        face = new FontFace(ACTIVE_FONT_FAMILY, src);
        await face.load();
        if (cancelled) return;
        document.fonts.add(face);
        // [diag] 오버레이 폰트(ActivePdfFont) 로드 성공/적용 확인. 실패하면 폴백(DefaultPdfFont/serif)으로 떨어진다.
        console.log("[diag:overlayFont] ActivePdfFont loaded", {
          src: font ? `upload:${font.name}` : "default:human-myeongjo.ttf",
          activeReady: document.fonts.check(`16px "${ACTIVE_FONT_FAMILY}"`),
          defaultReady: document.fonts.check('16px "DefaultPdfFont"'),
        });
      } catch (error) {
        console.error("[diag:overlayFont] ActivePdfFont load FAILED → falls back to DefaultPdfFont/serif", error);
      }
    }

    void loadActiveFont();
    return () => {
      cancelled = true;
      if (face) document.fonts.delete(face);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [font]);

  /**
   * base 모드: 항목 라벨(위치를 잡아야 하므로 비어 있으면 "항목"으로 표시).
   * adjust 모드: 이 열의 실제 값. 값이 비어 있으면 라벨로 채우지 않고 그대로 빈 값으로 둔다.
   */
  function getAreaValue(rowId: string) {
    if (!column) {
      const label = rows.find((row) => row.id === rowId)?.label ?? "";
      return label || "항목";
    }
    if (column.images?.[rowId]) return column.images[rowId]?.name ?? "이미지";
    return column.values[rowId] ?? "";
  }

  function isImageArea(area: PdfArea) {
    return resolveAreaKind(area, column) === "image";
  }

  /**
   * 기준 영역 + 보정을 합친 최종 정규화 영역(위치·크기). base 모드는 기준 그대로,
   * adjust 모드는 이 열의 보정(위치 오프셋 + 크기 덮어쓰기)을 반영한다.
   * 렌더러(toPageRect)와 동일한 resolveArea를 공유 → 화면 = 출력.
   */
  function resolved(area: PdfArea) {
    return resolveArea(area, isAdjust ? adjust : undefined);
  }

  // 박스 크기는 사용자가 직접 조절한 값을 그대로 쓴다(텍스트 폭에 강제로 맞추지 않음).
  // → 텍스트는 박스 폭에서 줄바꿈, 이미지는 박스 안에 contain 된다.
  const normalizedAreas = areas;
  const pageAreas = useMemo(() => normalizedAreas.filter((area) => area.page === page), [normalizedAreas, page]);
  const selectedArea = areas.find((area) => area.id === selectedAreaId);
  const selectedRow = rows.find((row) => row.id === selectedRowId);

  function addAreaAt(clientX?: number, clientY?: number) {
    if (isAdjust) return; // adjust 모드에서는 영역을 추가하지 않는다.
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
      pdfRowId: pdfRow.id,
      rowId: selectedRowId,
      page,
      x: clamp(x, 0, 1 - width),
      y: clamp(y, 0, 1 - height),
      width,
      height,
      fontSize: DEFAULT_FONT_SIZE,
      // kind는 일부러 비워 둔다. 타입은 (이 영역 row × 열 셀 내용)에서 파생되므로
      // 명시값을 박으면 이미지가 올라온 열에서도 text로 굳어 버린다.
    };

    setAreas((current) => [...current, area]);
    setSelectedAreaId(area.id);
  }

  function startDrag(event: ReactPointerEvent, area: PdfArea) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    // 미리보기 상태에서 블록을 누르면 편집 상태로 진입한다.
    if (isAdjust && !editing) setEditing(true);
    if (isAdjust) {
      const override = adjust.overrides[area.id];
      dragRef.current = {
        id: area.id,
        mode: "move",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: override?.dx ?? 0,
        startY: override?.dy ?? 0,
      };
    } else {
      dragRef.current = {
        id: area.id,
        mode: "move",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: area.x,
        startY: area.y,
      };
    }
  }

  /** 영역 박스 크기 조절 시작. base=기준 크기, adjust=이 열의 크기 덮어쓰기. */
  function startResize(event: ReactPointerEvent, area: PdfArea) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    const box = resolved(area);
    dragRef.current = {
      id: area.id,
      mode: "resize",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: box.width,
      startY: box.height,
    };
  }

  function updateSelectedArea(patch: Partial<PdfArea>) {
    if (!selectedAreaId) return;
    setAreas((current) =>
      current.map((area) => (area.id === selectedAreaId ? { ...area, ...patch } : area)),
    );
  }

  function removeArea(id: string) {
    setAreas((current) => current.filter((area) => area.id !== id));
    setSelectedAreaId((current) => (current === id ? "" : current));
  }

  /**
   * 이 영역의 열별 보정을 "병합"한다(덮어쓰기 아님). 위치·크기 등 다른 필드는 보존된다.
   * override를 바꾸는 모든 경로(드래그·리사이즈·px 입력)는 이 한 곳을 거쳐
   * "이동하면 크기가 사라지는" 부류의 버그를 구조적으로 막는다.
   */
  function patchOverride(areaId: string, patch: AreaOverride) {
    setAdjust((current) => ({
      ...current,
      overrides: { ...current.overrides, [areaId]: { ...current.overrides[areaId], ...patch } },
    }));
  }

  function setOverridePx(areaId: string, axis: "dx" | "dy", px: number) {
    const denom = axis === "dx" ? size.width : size.height;
    const value = px / denom;
    patchOverride(areaId, axis === "dx" ? { dx: value } : { dy: value });
  }

  /** 이 열에서만 적용되는 박스 크기 덮어쓰기(px 입력). */
  function setOverrideSizePx(areaId: string, axis: "width" | "height", px: number) {
    const denom = axis === "width" ? size.width : size.height;
    const min = axis === "width" ? MIN_AREA_WIDTH : MIN_AREA_HEIGHT;
    const value = clamp(px / denom, min, 1);
    patchOverride(areaId, axis === "width" ? { width: value } : { height: value });
  }

  /** 이 칸의 크기 덮어쓰기만 제거(위치 보정은 유지) → 기준 크기로 복귀. */
  function resetOverrideSize(areaId: string) {
    setAdjust((current) => {
      const prev = current.overrides[areaId];
      if (!prev) return current;
      const { width: _w, height: _h, ...rest } = prev;
      return { ...current, overrides: { ...current.overrides, [areaId]: rest } };
    });
  }

  /** 이 열의 모든 영역 보정(위치·크기)을 한 번에 초기화. */
  function resetAllAdjust() {
    setAdjust((current) => ({ ...current, overrides: {} }));
  }

  function resetSelectedOverride() {
    if (!selectedAreaId) return;
    setAdjust((current) => {
      const { [selectedAreaId]: _removed, ...overrides } = current.overrides;
      return { ...current, overrides };
    });
  }

  async function save() {
    if (isAdjust && column) {
      await repository.saveAdjust({ ...adjust, updatedAt: Date.now() });
    } else {
      await repository.replaceAreas(pdfRow.id, normalizedAreas);
    }
    onSaved();
    onClose();
  }

  function handleHoverMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (isAdjust || !selectedRowId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  const selectedOverridePx = selectedAreaId
    ? {
        dx: Math.round((adjust.overrides[selectedAreaId]?.dx ?? 0) * size.width),
        dy: Math.round((adjust.overrides[selectedAreaId]?.dy ?? 0) * size.height),
      }
    : { dx: 0, dy: 0 };

  // 선택 영역의 현재 박스 크기(px) — adjust 모드는 이 열의 덮어쓰기 반영.
  const selectedSizePx = selectedArea
    ? {
        width: Math.round(resolved(selectedArea).width * size.width),
        height: Math.round(resolved(selectedArea).height * size.height),
      }
    : { width: 0, height: 0 };

  // [diag] 편집 오버레이의 area별 박스/폰트(px). 출력 [diag:textRender](pt)와 같은 area를 비교한다.
  // 참고: viewport = pageSize(pt) × DISPLAY_SCALE 이므로, 정상이면 boxWidthPx ≈ rectWidth × 1.35,
  // fontPx ≈ fontSize × 1.35 여야 한다. 어긋나면 페이지 크기/회전 또는 폰트가 둘 사이에서 다른 것.
  useEffect(() => {
    if (!canEdit) return;
    for (const area of pageAreas) {
      const box = resolved(area);
      // PDF pt 기준으로 환산해 [diag:render]와 바로 비교(화면 px ÷ DISPLAY_SCALE).
      const xPt = (box.x * size.width) / DISPLAY_SCALE;
      const wPt = (box.width * size.width) / DISPLAY_SCALE;
      console.log(
        `[diag:overlay] "${getAreaValue(area.rowId)}" size=${box.fontSize} ` +
          `pt x=${xPt.toFixed(1)} w=${wPt.toFixed(1)} right=${(xPt + wPt).toFixed(1)} ` +
          `topPt=${((box.y * size.height) / DISPLAY_SCALE).toFixed(1)} row=${area.rowId}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageAreas, size, adjust, canEdit]);

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <section className="modal">
        <header className="modalHeader">
          <div>
            <h2>
              {isAdjust ? `${column?.name} 미세조정` : "기준 영역 편집"} / {pdfRow.pdf?.name ?? pdfRow.label}
            </h2>
            <p>
              {isAdjust
                ? "영역을 선택해 드래그하거나 방향키로 살짝 밀어 이 열만 맞춥니다. (Shift+방향키 10px)"
                : "왼쪽 항목을 선택한 뒤 PDF 위를 클릭하면 기준 영역이 추가됩니다. 모든 열이 이 위치를 공유합니다."}
            </p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} title="닫기">
            <X size={20} />
          </button>
        </header>

        <div className="setupLayout">
          <aside className="fieldRail">
            {/* 항목 목록은 기준 편집(base)에서만. 미세조정은 캔버스의 박스를 직접 클릭해 잡는다. */}
            {!isAdjust ? (
              <>
                <div className="railTitle">항목</div>
                <div className="fieldList">
                  {rows.map((row) => (
                    <button
                      className={row.id === selectedRowId ? "fieldButton active" : "fieldButton"}
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedRowId(row.id)}
                    >
                      <span>{row.label || "항목 없음"}</span>
                      <strong>{getAreaValue(row.id) || "값 없음"}</strong>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {!isAdjust ? (
              <button
                className="button primary full"
                type="button"
                disabled={!selectedRowId}
                onClick={() => addAreaAt()}
              >
                <Plus size={16} />
                영역 추가
              </button>
            ) : null}

            {isAdjust && !editing ? (
              <div className="areaEditor">
                <p>미리보기 상태입니다. PDF 위 블록을 클릭하거나 아래 버튼으로 수정하세요.</p>
                <button className="button primary full" type="button" onClick={() => setEditing(true)}>
                  <Pencil size={16} />
                  수정하기
                </button>
              </div>
            ) : null}

            {isAdjust && editing ? (
              <div className="areaEditor">
                <button className="button secondary full" type="button" onClick={resetAllAdjust}>
                  <RotateCcw size={16} />
                  전체 보정 초기화
                </button>
                <button
                  className="button secondary full"
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setSelectedAreaId("");
                  }}
                >
                  <Eye size={16} />
                  미리보기
                </button>
              </div>
            ) : null}

            {canEdit ? (
              <div className="areaEditor">
                <div className="railTitle">선택 영역</div>
                {selectedArea ? (
                  isAdjust ? (
                  <>
                    <label>
                      좌우 보정(px)
                      <input
                        type="number"
                        value={selectedOverridePx.dx}
                        onChange={(event) => setOverridePx(selectedArea.id, "dx", Number(event.target.value))}
                      />
                    </label>
                    <label>
                      상하 보정(px)
                      <input
                        type="number"
                        value={selectedOverridePx.dy}
                        onChange={(event) => setOverridePx(selectedArea.id, "dy", Number(event.target.value))}
                      />
                    </label>
                    <div className="railTitle">이 칸 크기 (px)</div>
                    <label>
                      가로
                      <input
                        type="number"
                        min={1}
                        value={selectedSizePx.width}
                        onChange={(event) => setOverrideSizePx(selectedArea.id, "width", Number(event.target.value))}
                      />
                    </label>
                    <label>
                      세로
                      <input
                        type="number"
                        min={1}
                        value={selectedSizePx.height}
                        onChange={(event) => setOverrideSizePx(selectedArea.id, "height", Number(event.target.value))}
                      />
                    </label>
                    <button className="button secondary full" type="button" onClick={() => resetOverrideSize(selectedArea.id)}>
                      <RotateCcw size={16} />
                      이 칸 크기 초기화
                    </button>
                    <button className="button secondary full" type="button" onClick={resetSelectedOverride}>
                      <RotateCcw size={16} />
                      이 칸 보정 초기화
                    </button>
                  </>
                ) : (
                  <>
                    <label>
                      연결 항목
                      <select
                        value={selectedArea.rowId}
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
                      크기
                      <input
                        type="number"
                        min={6}
                        max={48}
                        value={selectedArea.fontSize}
                        onChange={(event) => {
                          // 폰트 크기를 바꾸면 박스 높이도 한 줄에 맞춰 다시 잡는다.
                          // (안 그러면 height가 옛 폰트 기준으로 남아 편집(auto)·출력이 어긋난다.)
                          const fontSize = Number(event.target.value);
                          updateSelectedArea({ fontSize, height: measureAreaHeight(fontSize, size.height) });
                        }}
                      />
                    </label>
                    <button className="button danger full" type="button" onClick={() => removeArea(selectedAreaId)}>
                      <Trash2 size={16} />
                      영역 삭제
                    </button>
                  </>
                )
                ) : (
                  <p>PDF 위 영역을 선택하세요.</p>
                )}
              </div>
            ) : null}
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
              {previewBusy ? <div className="loading">미리보기 만드는 중</div> : null}
              {error ? <div className="loading">{error}</div> : null}
              <div className="pdfCanvasBox" style={{ width: size.width, height: size.height }}>
                <canvas ref={canvasRef} />
                {canEdit ? (
                <div
                  className="areaOverlay"
                  ref={overlayRef}
                  onMouseMove={handleHoverMove}
                  onMouseLeave={() => setHoverPoint(null)}
                  onClick={(event) => {
                    if (event.target === event.currentTarget) {
                      if (isAdjust) setSelectedAreaId("");
                      else addAreaAt(event.clientX, event.clientY);
                    }
                  }}
                >
                  {!isAdjust && hoverPoint && selectedRowId ? (
                    <div
                      className="placementPreview"
                      style={{ left: hoverPoint.x, top: hoverPoint.y, fontSize: DEFAULT_FONT_SIZE * DISPLAY_SCALE }}
                    >
                      {getAreaValue(selectedRowId)}
                    </div>
                  ) : null}
                  {pageAreas.map((area) => {
                    const box = resolved(area);
                    const isImg = isImageArea(area);
                    return (
                      <div
                        className={[
                          "mappedArea",
                          isImg ? "imageArea" : "textArea",
                          area.id === selectedAreaId ? "selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={area.id}
                        style={{
                          left: box.x * size.width,
                          top: box.y * size.height,
                          width: box.width * size.width,
                          // 이미지: contain 기준이라 높이 고정.
                          // 텍스트: 한 줄(minHeight) 이상이면 내용에 맞춰 세로로 늘어나 줄바꿈을 감싼다(출력 렌더러와 동일).
                          ...(isImg
                            ? { height: box.height * size.height }
                            : {
                                minHeight: Math.max(
                                  box.height * size.height,
                                  box.fontSize * DISPLAY_SCALE * LINE_HEIGHT,
                                ),
                              }),
                          fontSize: box.fontSize * DISPLAY_SCALE,
                        }}
                        onPointerDown={(event) => startDrag(event, area)}
                      >
                        {isImg && imageUrls[area.rowId] ? (
                          <img src={imageUrls[area.rowId]} alt={getAreaValue(area.rowId)} />
                        ) : (
                          <span className="areaLabel">{getAreaValue(area.rowId)}</span>
                        )}
                        {!isAdjust ? (
                          <button
                            type="button"
                            className="areaDeleteButton"
                            title="영역 삭제"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeArea(area.id);
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                        {area.id === selectedAreaId ? (
                          <span
                            className="areaResizeHandle"
                            title="크기 조절"
                            onPointerDown={(event) => startResize(event, area)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <footer className="modalFooter">
          <span>
            기준 영역 {normalizedAreas.length}개
            {!isAdjust && selectedRow ? ` · 선택 항목: ${selectedRow.label || "항목 없음"}` : ""}
          </span>
          <div>
            <button className="button secondary" type="button" onClick={onClose}>
              닫기
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!isAdjust && normalizedAreas.length === 0}
              onClick={() => void save()}
            >
              <Save size={16} />
              {isAdjust ? "보정 저장" : "기준 저장"}
            </button>
          </div>
        </footer>
      </section>
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
  if (context) context.font = `${displayFontSize}px ${AREA_FONT_FAMILY}`;
  const measuredWidth = context?.measureText(text).width ?? text.length * displayFontSize;
  const pixelWidth = Math.max(18, measuredWidth + 14);
  return clamp(pixelWidth / pageWidth, 0.02, 0.9);
}

function measureAreaHeight(fontSize: number, pageHeight: number) {
  // pageHeight는 화면 px(=PDF pt × DISPLAY_SCALE)이므로 fontSize(pt)도 같은 px 단위로 환산해야 한다.
  // (과거엔 pt를 px로 안 바꿔 나눠서 박스 높이가 DISPLAY_SCALE배 작게 잡혔다.)
  // 한 줄 높이는 렌더러의 LINE_HEIGHT와 동일하게 맞춰 편집 = 출력.
  const lineHeightPx = fontSize * DISPLAY_SCALE * LINE_HEIGHT;
  return clamp(lineHeightPx / pageHeight, 0.001, 0.2);
}
