import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { FieldRow, ValueColumn } from "../types";

/** 시트의 한 칸. columnId가 없으면 항목 라벨 칸. */
export type SheetCellPoint = {
  rowId: string;
  columnId?: string;
};

type SheetSelection = {
  anchor: SheetCellPoint;
  focus: SheetCellPoint;
};

export type SheetSelectionController = {
  select: (point: SheetCellPoint) => void;
  focus: (point: SheetCellPoint) => void;
  extend: (point: SheetCellPoint) => void;
  setRange: (anchor: SheetCellPoint, focus: SheetCellPoint) => void;
  clear: () => void;
  clearIfRow: (rowId: string) => void;
  clearIfColumn: (columnId: string) => void;
  getCellClass: (rowId: string, columnId?: string) => string;
  handleCopy: (event: ClipboardEvent<HTMLElement>) => void;
};

/**
 * 시트 범위 선택(드래그/포커스)과 선택 영역 복사를 담당한다.
 * 선택은 셀 id 쌍(anchor/focus)으로 들고, 사각형 범위는 rows/columns의
 * 현재 인덱스로 계산하므로 행/열이 재정렬돼도 선택 의미가 유지된다.
 */
export function useSheetSelection(rows: FieldRow[], columns: ValueColumn[]): SheetSelectionController {
  const [selection, setSelection] = useState<SheetSelection>();
  // 드래그로 범위를 넓히는 중인지. pointerdown(select)~window pointerup 동안만 true.
  const selectingRef = useRef(false);

  useEffect(() => {
    function onPointerUp() {
      selectingRef.current = false;
    }
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, []);

  function select(point: SheetCellPoint) {
    selectingRef.current = true;
    setSelection({ anchor: point, focus: point });
  }

  function focus(point: SheetCellPoint) {
    if (selectingRef.current) return;
    setSelection({ anchor: point, focus: point });
  }

  function extend(point: SheetCellPoint) {
    if (!selectingRef.current) return;
    setSelection((current) => (current ? { ...current, focus: point } : { anchor: point, focus: point }));
  }

  /** 붙여넣기 등에서 결과 범위를 통째로 선택할 때 사용. */
  function setRange(anchor: SheetCellPoint, focus: SheetCellPoint) {
    setSelection({ anchor, focus });
  }

  function clear() {
    setSelection(undefined);
  }

  /** 이 행이 선택의 끝점이면 선택을 해제한다(행 삭제 시). */
  function clearIfRow(rowId: string) {
    setSelection((current) =>
      current?.anchor.rowId === rowId || current?.focus.rowId === rowId ? undefined : current,
    );
  }

  /** 이 열이 선택의 끝점이면 선택을 해제한다(열 삭제 시). */
  function clearIfColumn(columnId: string) {
    setSelection((current) =>
      current?.anchor.columnId === columnId || current?.focus.columnId === columnId ? undefined : current,
    );
  }

  function pointIndexes(point: SheetCellPoint) {
    return {
      rowIndex: rows.findIndex((row) => row.id === point.rowId),
      columnIndex: point.columnId ? columns.findIndex((column) => column.id === point.columnId) : -1,
    };
  }

  function getBounds() {
    if (!selection) return undefined;

    const anchor = pointIndexes(selection.anchor);
    const focus = pointIndexes(selection.focus);
    if (
      anchor.rowIndex < 0 ||
      focus.rowIndex < 0 ||
      (selection.anchor.columnId && anchor.columnIndex < 0) ||
      (selection.focus.columnId && focus.columnIndex < 0)
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

  function copyValue(row: FieldRow, columnIndex: number) {
    if (columnIndex < 0) return row.label;
    const column = columns[columnIndex];
    if (!column) return "";
    return column.images?.[row.id]?.name ?? column.values[row.id] ?? "";
  }

  /** 선택 범위를 탭 구분 텍스트로 클립보드에 싣는다(시트 컨테이너의 onCopyCapture). */
  function handleCopy(event: ClipboardEvent<HTMLElement>) {
    const bounds = getBounds();
    if (!bounds) return;

    const text = rows
      .slice(bounds.minRow, bounds.maxRow + 1)
      .map((row) => {
        const values: string[] = [];
        for (let columnIndex = bounds.minColumn; columnIndex <= bounds.maxColumn; columnIndex += 1) {
          values.push(copyValue(row, columnIndex));
        }
        return values.join("\t");
      })
      .join("\n");

    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }

  function getCellClass(rowId: string, columnId?: string) {
    const classes = ["sheetCell"];
    if (!selection) return classes.join(" ");

    const cellRowIndex = rows.findIndex((row) => row.id === rowId);
    const cellColumnIndex = columnId ? columns.findIndex((column) => column.id === columnId) : -1;
    const bounds = getBounds();
    if (cellRowIndex < 0 || (columnId && cellColumnIndex < 0) || !bounds) {
      return classes.join(" ");
    }

    const selected =
      cellRowIndex >= bounds.minRow &&
      cellRowIndex <= bounds.maxRow &&
      cellColumnIndex >= bounds.minColumn &&
      cellColumnIndex <= bounds.maxColumn;
    const active = selection.anchor.rowId === rowId && selection.anchor.columnId === columnId;

    if (selected) classes.push("selectedSheetCell");
    if (active) classes.push("activeSheetCell");
    return classes.join(" ");
  }

  return { select, focus, extend, setRange, clear, clearIfRow, clearIfColumn, getCellClass, handleCopy };
}
