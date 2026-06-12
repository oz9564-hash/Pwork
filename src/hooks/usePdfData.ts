import { useEffect, useRef, useState } from "react";
import { createDebouncedSaver } from "../lib/debounceSave";
import { createId } from "../lib/ids";
import { persist as runPersist } from "../lib/persist";
import { exportPdf } from "../services/pdfExport";
import { repository } from "../services/storage";
import type { ColumnPdfAdjust, CommonPdf, FieldRow, FontAsset, PdfArea, PdfSlotRow, ValueColumn } from "../types";
import type { BusyFeedback, UploadNotice } from "../components/StatusOverlays";

type Options = {
  notify: (notice: UploadNotice) => void;
  setBusyFeedback: (feedback?: BusyFeedback) => void;
  setBusyId: (id?: string) => void;
};

/**
 * PDF 도메인 상태와 영속화를 담당한다: PDF 행, 공통 PDF 파일, 기준 영역(모든 열 공유),
 * 열별 보정(adjust), 출력 폰트, 그리고 결과 PDF 다운로드.
 * 시트 도메인은 모른다. 다운로드는 시트 rows를 인자로 받아 훅 간 의존을 끊는다.
 */
export function usePdfData({ notify, setBusyFeedback, setBusyId }: Options) {
  const [pdfRows, setPdfRows] = useState<PdfSlotRow[]>([]);
  // 기준 영역(모든 열 공유) + 열별 보정. PDF 파일은 PDF 행에 1장씩(pdfRow.pdf).
  const [baseAreas, setBaseAreas] = useState<PdfArea[]>([]);
  const [adjusts, setAdjusts] = useState<ColumnPdfAdjust[]>([]);
  const [font, setFont] = useState<FontAsset>();

  const notifySaveError = () =>
    notify({
      tone: "error",
      title: "저장 실패",
      description: "변경 내용을 저장하지 못했습니다. 인터넷 연결을 확인해 주세요.",
    });
  const persist = (action: () => Promise<unknown>) => runPersist(action, notifySaveError);

  const pdfRowSaver = useRef(
    createDebouncedSaver<PdfSlotRow>((row) => repository.savePdfRow(row), { onError: notifySaveError }),
  ).current;

  // 언마운트/페이지 종료 직전에 남은 PDF 행 편집을 마저 저장한다.
  useEffect(() => {
    const flushPending = () => {
      void pdfRowSaver.flushAll();
    };
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("beforeunload", flushPending);
      flushPending();
    };
  }, [pdfRowSaver]);

  async function load() {
    const [storedPdfRows, storedAreas, storedAdjusts, storedFont] = await Promise.all([
      repository.getPdfRows(),
      repository.getAllAreas(),
      repository.getAllAdjusts(),
      repository.getFont(),
    ]);
    setPdfRows(storedPdfRows.sort((a, b) => a.createdAt - b.createdAt));
    setBaseAreas(storedAreas);
    setAdjusts(storedAdjusts);
    setFont(storedFont);
  }

  function reset() {
    setPdfRows([]);
    setBaseAreas([]);
    setAdjusts([]);
    setFont(undefined);
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

  /** 이 (열 × PDF행)에 실제로 덮어쓴 보정값이 하나라도 있는지. 미세조정 버튼 색 판정에 쓴다. */
  function hasAdjust(columnId: string, pdfRowId: string) {
    const adjust = findAdjust(columnId, pdfRowId);
    return Boolean(adjust && Object.keys(adjust.overrides).length > 0);
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
    if (!(await persist(() => pdfRowSaver.bypass(pdfRowId, () => repository.deletePdfRow(pdfRowId))))) return;
    setPdfRows((current) => current.filter((row) => row.id !== pdfRowId));
    setBaseAreas((current) => current.filter((area) => area.pdfRowId !== pdfRowId));
    setAdjusts((current) => current.filter((adjust) => adjust.pdfRowId !== pdfRowId));
  }

  /** PDF 행에 공통 PDF 1장을 올리거나 교체한다. */
  async function uploadCommonPdf(pdfRow: PdfSlotRow, file: File | undefined) {
    if (!file) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      notify({
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
      const pdf: CommonPdf = { name: file.name, updatedAt: Date.now() };
      // saveCommonPdf는 행 문서 전체를 쓰므로 bypass로 이 행의 라벨 저장 예약을 걷어낸다.
      const nextRow = await pdfRowSaver.bypass(pdfRow.id, () => repository.saveCommonPdf(pdfRow, file, pdf));
      setPdfRows((current) => current.map((row) => (row.id === pdfRow.id ? nextRow : row)));
      notify({
        tone: "success",
        title: "PDF 입력 완료",
        description: `${file.name} 파일이 들어갔습니다.`,
      });
    } catch (error) {
      console.error("[pdf-upload] failed", error);
      notify({
        tone: "error",
        title: "PDF 입력 실패",
        description: "파일을 다시 확인해 주세요.",
      });
    } finally {
      setBusyFeedback(undefined);
    }
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

  /**
   * 한 열을 복제할 때 그 열의 PDF 보정(adjust)도 새 열로 복제한다.
   * PDF 파일·기준 영역은 공통이라 복사하지 않는다. 시트 열 복제(useSheetData) 직후 App이 호출한다.
   */
  async function copyAdjustsForColumn(sourceColumnId: string, target: ValueColumn) {
    const now = Date.now();
    const copiedAdjusts = adjusts
      .filter((adjust) => adjust.columnId === sourceColumnId)
      .map((adjust): ColumnPdfAdjust => ({
        ...adjust,
        id: repository.adjustId(target.id, adjust.pdfRowId),
        columnId: target.id,
        overrides: { ...adjust.overrides },
        updatedAt: now,
      }));
    for (const adjust of copiedAdjusts) await repository.saveAdjust(adjust);
    setAdjusts((current) => [...current, ...copiedAdjusts]);
  }

  /**
   * 한 (열 × PDF행) 결과 PDF를 만들어 내려받는다. 공통 파일·셀 이미지를 받아
   * 기준 영역 + 이 열의 보정으로 채운다. 단건/일괄 다운로드가 공유하는 단일 경로.
   */
  async function exportColumnPdf(column: ValueColumn, pdfRow: PdfSlotRow, areas: PdfArea[], rows: FieldRow[]) {
    if (!pdfRow.pdf) return;
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
  }

  async function downloadFilledPdf(column: ValueColumn, pdfRow: PdfSlotRow, rows: FieldRow[]) {
    if (!pdfRow.pdf) return;
    const areas = areasForPdfRow(pdfRow.id);
    if (areas.length === 0) return;

    setBusyId(`${column.id}:${pdfRow.id}`);
    try {
      await exportColumnPdf(column, pdfRow, areas, rows);
    } catch (error) {
      console.error("[pdf-download] failed", error);
      notify({
        tone: "error",
        title: "PDF 다운로드 실패",
        description: "PDF 원본을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  /** 이 열의 모든 PDF(기준 영역이 있는 PDF 행)를 한꺼번에 내려받는다. */
  async function downloadPdfColumn(column: ValueColumn, rows: FieldRow[]) {
    const targets = pdfRows.filter((pdfRow) => pdfRow.pdf && areasForPdfRow(pdfRow.id).length > 0);
    if (targets.length === 0) return;

    setBusyId(column.id);
    setBusyFeedback({
      title: `${column.name} PDF 다운로드 중`,
      description: "완료될 때까지 기다려주세요.",
    });
    try {
      for (const pdfRow of targets) {
        await exportColumnPdf(column, pdfRow, areasForPdfRow(pdfRow.id), rows);
      }
    } catch (error) {
      console.error("[pdf-column-download] failed", error);
      notify({
        tone: "error",
        title: "일괄 다운로드 실패",
        description: "일부 PDF를 만들지 못했습니다. 다시 시도해 주세요.",
      });
    } finally {
      setBusyId(undefined);
      setBusyFeedback(undefined);
    }
  }

  return {
    pdfRows,
    font,
    load,
    reset,
    reloadPdfData,
    areasForPdfRow,
    hasAdjust,
    addPdfRow,
    updatePdfRow,
    deletePdfRow,
    uploadCommonPdf,
    uploadFont,
    clearFont,
    copyAdjustsForColumn,
    downloadFilledPdf,
    downloadPdfColumn,
  };
}
