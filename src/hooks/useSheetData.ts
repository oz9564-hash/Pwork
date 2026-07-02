import { useEffect, useRef, useState } from "react";
import { createDebouncedSaver } from "../lib/debounceSave";
import { saveStatusStore } from "../lib/saveStatus";
import { createId } from "../lib/ids";
import { optimizeImageFile } from "../lib/imageOptimize";
import { persist as runPersist } from "../lib/persist";
import { repository } from "../services/storage";
import type { FieldRow, ValueColumn } from "../types";
import type { BusyFeedback, UploadNotice } from "../components/StatusOverlays";
import type { SheetCellPoint } from "./useSheetSelection";

const initialRows = ["이름", "비밀번호"];

/** 붙여넣기 결과로 선택할 범위(앵커/포커스 셀). */
type PasteRange = { anchor: SheetCellPoint; focus: SheetCellPoint };

type Options = {
  notify: (notice: UploadNotice) => void;
  setBusyFeedback: (feedback?: BusyFeedback) => void;
  setBusyId: (id?: string) => void;
};

/**
 * 시트 도메인(항목 행 + 값 열) 상태와 영속화를 담당한다.
 * - 텍스트 편집은 row/column saver로 디바운스 저장.
 * - 디바운스를 우회해 문서 전체를 즉시 쓰는 경로는 반드시 saver.bypass로 감싸 stale write를 막는다.
 * - 낙관적 갱신 금지: 로컬 state는 저장 성공 후에만 바꾼다.
 * 선택(useSheetSelection)과 PDF 도메인은 모른다. 그쪽 연동은 App이 반환값으로 오케스트레이션한다.
 */
export function useSheetData({ notify, setBusyFeedback, setBusyId }: Options) {
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [columns, setColumns] = useState<ValueColumn[]>([]);

  // 최신 state를 동기적으로 읽기 위한 미러. update*에서 setState updater 안에 의존하면
  // React 18에선 updater가 나중에 실행돼 직후 코드가 stale을 보므로(저장 예약 누락 버그),
  // 여기서 ref로 최신값을 들고 즉시 계산한다. 그 외 경로의 변경도 effect로 따라잡는다.
  const rowsRef = useRef(rows);
  const columnsRef = useRef(columns);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  const notifySaveError = () =>
    notify({
      tone: "error",
      title: "저장 실패",
      description: "변경 내용을 저장하지 못했습니다. 인터넷 연결을 확인해 주세요.",
    });
  const persist = (action: () => Promise<unknown>) => runPersist(action, notifySaveError);

  // 저장은 blur/Enter 커밋이 1차 경로다. 디바운스 타이머(5초)는 셀에서 안 나가고 멈춰도
  // 결국 저장되게 하는 안전망. flush가 예약을 지우므로 커밋·타이머가 겹쳐도 쓰기는 1회다.
  const columnSaver = useRef(
    createDebouncedSaver<ValueColumn>((column) => repository.saveColumn(column), {
      delay: 5000,
      onError: notifySaveError,
      status: saveStatusStore,
      namespace: "col",
    }),
  ).current;
  const rowSaver = useRef(
    createDebouncedSaver<FieldRow>((row) => repository.saveRow(row), {
      delay: 5000,
      onError: notifySaveError,
      status: saveStatusStore,
      namespace: "row",
    }),
  ).current;

  /**
   * 대기 중인 디바운스 저장을 즉시 모두 기록한다.
   * 페이지 종료(beforeunload)뿐 아니라 인앱 로그아웃 직전처럼
   * "아직 로그인 상태일 때 마지막 편집을 확정"해야 하는 곳에서 await 해야 한다.
   */
  async function flushPendingSaves() {
    await Promise.all([columnSaver.flushAll(), rowSaver.flushAll()]);
  }

  /** 한 항목 행을 즉시 기록한다(입력 blur/Enter 커밋용). 변경 없으면 no-op. */
  async function commitRow(rowId: string) {
    await rowSaver.flush(rowId);
  }

  /** 한 값 열(이름/셀 값 공용)을 즉시 기록한다(입력 blur/Enter 커밋용). 변경 없으면 no-op. */
  async function commitColumn(columnId: string) {
    await columnSaver.flush(columnId);
  }

  /**
   * 현재 시트 전체(모든 항목 행 + 값 열)를 Firestore에 즉시 강제 기록한다.
   * 디바운스를 기다리지 않는 수동 "저장하기"용. 대기 예약을 먼저 걷어내고(bypass)
   * 최신 state를 통째로 쓰므로, 쓰기가 실제로 성공하는지(권한/네트워크)도 여기서 드러난다.
   */
  async function saveAllNow() {
    await rowSaver.bypass(
      rows.map((row) => row.id),
      () =>
        columnSaver.bypass(
          columns.map((column) => column.id),
          () =>
            Promise.all([
              ...rows.map((row) => repository.saveRow(row)),
              ...columns.map((column) => repository.saveColumn(column)),
            ]),
        ),
    );
  }

  // 언마운트/페이지 종료 직전에 남은 행/열 편집을 마저 저장한다.
  useEffect(() => {
    const flushPending = () => {
      void columnSaver.flushAll();
      void rowSaver.flushAll();
    };
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("beforeunload", flushPending);
      flushPending();
    };
  }, [columnSaver, rowSaver]);

  async function load() {
    const [storedRows, storedColumns] = await Promise.all([repository.getRows(), repository.getColumns()]);
    setRows(storedRows.sort((a, b) => a.createdAt - b.createdAt));
    setColumns(storedColumns.sort((a, b) => a.createdAt - b.createdAt));
  }

  function reset() {
    setRows([]);
    setColumns([]);
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

  function updateRow(rowId: string, label: string) {
    const next = rowsRef.current.map((row) => (row.id === rowId ? { ...row, label } : row));
    rowsRef.current = next;
    setRows(next);
    const changed = next.find((row) => row.id === rowId);
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
    const changedRows = reorderedRows.filter(
      (row, index) => row.createdAt !== rows[index]?.createdAt || row.id !== rows[index]?.id,
    );

    // 재정렬 결과는 즉시 기록한다. bypass가 이 행들의 디바운스 예약(라벨 저장)을 취소해
    // 나중에 실행된 예약이 createdAt(정렬 인덱스)을 되돌리는 것을 막는다.
    const ok = await persist(() =>
      rowSaver.bypass(
        changedRows.map((row) => row.id),
        () => Promise.all(changedRows.map((row) => repository.saveRow(row))),
      ),
    );
    if (!ok) return;
    setRows(reorderedRows);
  }

  /** 행 삭제. 선택 해제는 호출부(App)가 반환값을 보고 처리한다. */
  async function deleteRow(rowId: string): Promise<boolean> {
    // 삭제될 행의 라벨 저장 예약은 버리고(bypass), 셀 값 편집 예약은 먼저 반영한 뒤 삭제한다.
    // (repository.deleteRow가 각 열에서 이 행의 값을 제거하므로 순서가 중요하다.)
    await columnSaver.flushAll();
    if (!(await persist(() => rowSaver.bypass(rowId, () => repository.deleteRow(rowId))))) return false;
    setRows((current) => current.filter((row) => row.id !== rowId));
    setColumns((current) =>
      current.map((column) => {
        const { [rowId]: _removed, ...values } = column.values;
        const { [rowId]: _removedImage, ...images } = column.images ?? {};
        return { ...column, values, images };
      }),
    );
    return true;
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

  /**
   * 열을 복제해 값·셀 이미지를 새 열로 복사하고 그 열을 돌려준다.
   * PDF 보정(adjust) 복제와 busy/에러 토스트는 App이 이어서 처리한다(도메인 간 오케스트레이션).
   * 실패하면 throw 한다.
   */
  async function duplicateColumn(source: ValueColumn): Promise<ValueColumn> {
    const now = Date.now();
    const copiedColumn: ValueColumn = {
      id: createId("col"),
      name: `${source.name} 복사`,
      values: { ...source.values },
      images: {},
      createdAt: now,
      updatedAt: now,
    };

    let nextColumn = copiedColumn;
    try {
      const imageCopies = await Promise.all(
        Object.entries(source.images ?? {}).map(async ([rowId, image]) => ({
          rowId,
          image,
          file: await repository.getCellImageFile(source.id, rowId, image),
        })),
      );

      await repository.saveColumn(nextColumn);

      for (const { rowId, image, file } of imageCopies) {
        nextColumn = await repository.saveCellImage(nextColumn, rowId, file, image);
      }
    } catch (error) {
      await repository.deleteColumn(copiedColumn.id).catch((cleanupError) => {
        console.error("[column-duplicate] cleanup failed", cleanupError);
      });
      throw error;
    }

    setColumns((current) => [...current, nextColumn]);
    return nextColumn;
  }

  function updateColumnName(columnId: string, name: string) {
    const next = columnsRef.current.map((column) =>
      column.id === columnId ? { ...column, name, updatedAt: Date.now() } : column,
    );
    columnsRef.current = next;
    setColumns(next);
    const changed = next.find((column) => column.id === columnId);
    if (changed) columnSaver.schedule(changed.id, changed);
  }

  /** 열 삭제. 선택 해제는 호출부(App)가 반환값을 보고 처리한다. PDF 보정 삭제는 repository가 함께 처리. */
  async function deleteColumn(columnId: string): Promise<boolean> {
    // 삭제되는 열의 디바운스 저장이 삭제 후 실행돼 문서를 되살리지 않도록 bypass로 지운다.
    if (!(await persist(() => columnSaver.bypass(columnId, () => repository.deleteColumn(columnId))))) return false;
    setColumns((current) => current.filter((column) => column.id !== columnId));
    return true;
  }

  function updateCell(columnId: string, rowId: string, value: string) {
    const next = columnsRef.current.map((column) =>
      column.id === columnId
        ? { ...column, values: { ...column.values, [rowId]: value }, updatedAt: Date.now() }
        : column,
    );
    columnsRef.current = next;
    setColumns(next);
    const changed = next.find((column) => column.id === columnId);
    if (changed) columnSaver.schedule(changed.id, changed);
  }

  function clearCells(cells: Array<{ rowId: string; columnId: string }>) {
    const rowIdsByColumn = new Map<string, Set<string>>();
    for (const cell of cells) {
      const rowIds = rowIdsByColumn.get(cell.columnId) ?? new Set<string>();
      rowIds.add(cell.rowId);
      rowIdsByColumn.set(cell.columnId, rowIds);
    }

    const clearedValues: Array<{ rowId: string; columnId: string; value: string }> = [];
    for (const column of columnsRef.current) {
      const rowIds = rowIdsByColumn.get(column.id);
      if (!rowIds) continue;
      for (const rowId of rowIds) {
        const value = column.values[rowId] ?? "";
        if (value) clearedValues.push({ rowId, columnId: column.id, value });
      }
    }

    const next = columnsRef.current.map((column) => {
      const rowIds = rowIdsByColumn.get(column.id);
      if (!rowIds) return column;
      const values = { ...column.values };
      for (const rowId of rowIds) values[rowId] = "";
      return { ...column, values, updatedAt: Date.now() };
    });

    columnsRef.current = next;
    setColumns(next);
    for (const column of next) {
      if (rowIdsByColumn.has(column.id)) columnSaver.schedule(column.id, column);
    }
    return clearedValues;
  }

  function restoreCells(cells: Array<{ rowId: string; columnId: string; value: string }>) {
    const valuesByColumn = new Map<string, Map<string, string>>();
    for (const cell of cells) {
      const values = valuesByColumn.get(cell.columnId) ?? new Map<string, string>();
      values.set(cell.rowId, cell.value);
      valuesByColumn.set(cell.columnId, values);
    }

    const next = columnsRef.current.map((column) => {
      const restoredValues = valuesByColumn.get(column.id);
      if (!restoredValues) return column;
      const values = { ...column.values };
      for (const [rowId, value] of restoredValues) values[rowId] = value;
      return { ...column, values, updatedAt: Date.now() };
    });

    columnsRef.current = next;
    setColumns(next);
    for (const column of next) {
      if (valuesByColumn.has(column.id)) columnSaver.schedule(column.id, column);
    }
  }

  /**
   * 다중 셀 붙여넣기. 필요한 만큼 행/열을 늘려 값을 채우고, 선택할 범위를 돌려준다(없으면 undefined).
   * 선택 적용은 호출부(App)가 반환 범위로 처리한다.
   */
  async function pasteSheetCells(
    startRowId: string,
    startColumnId: string | undefined,
    cells: string[][],
  ): Promise<PasteRange | undefined> {
    const startRowIndex = rows.findIndex((row) => row.id === startRowId);
    const startColumnIndex = startColumnId ? columns.findIndex((column) => column.id === startColumnId) : -1;
    if (startRowIndex < 0 || (startColumnId && startColumnIndex < 0)) return undefined;

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

    const rowsToSave = nextRows.filter((row) => changedRows.has(row.id) || !existingRowIds.has(row.id));
    const columnsToSave = nextColumns.filter(
      (column) => changedColumnIds.has(column.id) || !existingColumnIds.has(column.id),
    );
    // 붙여넣기로 즉시 기록하는 행/열은 bypass로 디바운스 예약을 걷어내 stale write를 막는다.
    const ok = await persist(() =>
      rowSaver.bypass(
        rowsToSave.map((row) => row.id),
        () =>
          columnSaver.bypass(
            columnsToSave.map((column) => column.id),
            () =>
              Promise.all([
                ...rowsToSave.map((row) => repository.saveRow(row)),
                ...columnsToSave.map((column) => repository.saveColumn(column)),
              ]),
          ),
      ),
    );
    if (!ok) return undefined;

    setRows(nextRows);
    setColumns(nextColumns);

    return {
      anchor: {
        rowId: nextRows[startRowIndex].id,
        columnId: labelPaste ? undefined : nextColumns[startColumnIndex]?.id,
      },
      focus: {
        rowId: nextRows[targetRowCount - 1].id,
        columnId: targetColumnCount > 0 ? nextColumns[targetColumnCount - 1]?.id : undefined,
      },
    };
  }

  async function uploadCellImage(column: ValueColumn, rowId: string, file: File) {
    setBusyFeedback({
      title: "이미지 넣는 중",
      description: `${file.name} 파일을 최적화하고 저장하고 있습니다.`,
    });

    try {
      const optimized = await optimizeImageFile(file);
      // saveCellImage는 최신 상태의 column으로 전체 문서를 쓰므로, bypass로 이 열의
      // 디바운스 예약(텍스트 저장)이 나중에 실행돼 이미지를 덮어쓰는 것을 막는다.
      const changed = await columnSaver.bypass(column.id, () =>
        repository.saveCellImage(column, rowId, optimized.file, {
          name: optimized.name,
          contentType: optimized.contentType,
          width: optimized.width,
          height: optimized.height,
          updatedAt: Date.now(),
        }),
      );
      setColumns((current) => current.map((item) => (item.id === column.id ? changed : item)));
      notify({
        tone: "success",
        title: "이미지 입력 완료",
        description: `${optimized.name} 파일이 들어갔습니다.`,
      });
    } catch (error) {
      console.error("[image-upload] failed", error);
      notify({
        tone: "error",
        title: "이미지 입력 실패",
        description: "파일을 다시 확인해 주세요.",
      });
    } finally {
      setBusyFeedback(undefined);
    }
  }

  async function clearCellImage(column: ValueColumn, rowId: string) {
    let changed: ValueColumn | undefined;
    const ok = await persist(() =>
      columnSaver.bypass(column.id, async () => {
        changed = await repository.clearCellImage(column, rowId);
      }),
    );
    if (!ok || !changed) return;
    const next = changed;
    setColumns((current) => current.map((item) => (item.id === column.id ? next : item)));
  }

  return {
    rows,
    columns,
    load,
    reset,
    flushPendingSaves,
    saveAllNow,
    commitRow,
    commitColumn,
    createStarterSheet,
    addRow,
    updateRow,
    moveRow,
    deleteRow,
    addColumn,
    duplicateColumn,
    updateColumnName,
    deleteColumn,
    updateCell,
    clearCells,
    restoreCells,
    pasteSheetCells,
    uploadCellImage,
    clearCellImage,
  };
}
