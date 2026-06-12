import { Fragment, useState } from "react";
import type { ClipboardEvent } from "react";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { CellImageControl } from "./CellImageControl";
import type { SheetSelectionController } from "../hooks/useSheetSelection";
import type { FieldRow, ValueColumn } from "../types";

type Props = {
  rows: FieldRow[];
  columns: ValueColumn[];
  /** 열 복사 버튼 disabled 판정(복사 중인 열 id). */
  busyId?: string;
  selection: SheetSelectionController;
  onUpdateColumnName: (columnId: string, name: string) => void;
  onDuplicateColumn: (column: ValueColumn) => void;
  onDeleteColumn: (columnId: string) => void;
  onAddColumn: () => void;
  onAddRow: () => void;
  onUpdateRow: (rowId: string, label: string) => void;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (draggedRowId: string, targetRowId: string) => void;
  onUpdateCell: (columnId: string, rowId: string, value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>, rowId: string, columnId?: string) => void;
  onUploadCellImage: (column: ValueColumn, rowId: string, file: File) => void;
  onPreviewCellImage: (column: ValueColumn, rowId: string) => void;
  onClearCellImage: (column: ValueColumn, rowId: string) => void;
  /** 열 너비 조절 시작. 너비 상태/계산은 부모(.sheet 소유)가 들고 있다. */
  onColumnResizeStart: (columnId: string, clientX: number) => void;
};

/**
 * 값 입력 그리드(헤더 행 + 데이터 행들 + 항목 추가 행).
 * .sheet CSS Grid의 직접 자식이 되도록 Fragment를 반환한다(래퍼 div 금지).
 * 행 드래그 표시(draggingRowId)는 순수 로컬 UI라 여기서 소유한다.
 */
export function SheetGrid({
  rows,
  columns,
  busyId,
  selection,
  onUpdateColumnName,
  onDuplicateColumn,
  onDeleteColumn,
  onAddColumn,
  onAddRow,
  onUpdateRow,
  onDeleteRow,
  onMoveRow,
  onUpdateCell,
  onPaste,
  onUploadCellImage,
  onPreviewCellImage,
  onClearCellImage,
  onColumnResizeStart,
}: Props) {
  const [draggingRowId, setDraggingRowId] = useState<string>();

  return (
    <>
      <div className="sheetCell sheetHead stickyCol">항목</div>
      {columns.map((column) => (
        <div className="sheetCell sheetHead columnHead" key={column.id}>
          <input
            value={column.name}
            aria-label="열 이름"
            onChange={(event) => void onUpdateColumnName(column.id, event.target.value)}
          />
          <div className="columnTools">
            <button
              type="button"
              title="열 복사"
              disabled={busyId === column.id}
              onClick={() => void onDuplicateColumn(column)}
            >
              <Copy size={15} />
            </button>
            <button type="button" title="열 삭제" onClick={() => void onDeleteColumn(column.id)}>
              <Trash2 size={15} />
            </button>
          </div>
          <div
            className="columnResizeHandle"
            role="separator"
            aria-label="열 너비 조절"
            onPointerDown={(event) => onColumnResizeStart(column.id, event.clientX)}
          />
        </div>
      ))}
      <div className="sheetCell sheetHead addColumnCell">
        <button className="addSheetButton" type="button" onClick={() => void onAddColumn()}>
          <Plus size={16} />열 추가
        </button>
      </div>

      {rows.map((row) => (
        <Fragment key={row.id}>
          <div
            className={`${selection.getCellClass(row.id)} rowLabel stickyCol${draggingRowId === row.id ? " draggingRow" : ""}`}
            key={`${row.id}-label`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              selection.select({ rowId: row.id });
            }}
            onPointerEnter={() => selection.extend({ rowId: row.id })}
            onDragOver={(event) => {
              if (!draggingRowId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceRowId = event.dataTransfer.getData("text/plain") || draggingRowId;
              setDraggingRowId(undefined);
              if (sourceRowId) void onMoveRow(sourceRowId, row.id);
            }}
          >
            <button
              className="rowDragHandle"
              type="button"
              draggable
              title="행 위치 이동"
              onPointerDown={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                setDraggingRowId(row.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.id);
              }}
              onDragEnd={() => setDraggingRowId(undefined)}
            >
              <GripVertical size={14} />
            </button>
            <input
              value={row.label}
              aria-label="항목명"
              placeholder="항목"
              onFocus={() => selection.focus({ rowId: row.id })}
              onPaste={(event) => onPaste(event, row.id)}
              onChange={(event) => void onUpdateRow(row.id, event.target.value)}
            />
            <button type="button" title="항목 삭제" onClick={() => void onDeleteRow(row.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          {columns.map((column) => {
            const image = column.images?.[row.id];
            return (
              <div
                className={`${selection.getCellClass(row.id, column.id)} valueCell`}
                key={`${row.id}-${column.id}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  selection.select({ rowId: row.id, columnId: column.id });
                }}
                onPointerEnter={() => selection.extend({ rowId: row.id, columnId: column.id })}
              >
                <div className={image ? "cellValueWrap hasImage" : "cellValueWrap"}>
                  {image ? null : (
                    <input
                      className="cellTextInput"
                      value={column.values[row.id] ?? ""}
                      aria-label={`${column.name} ${row.label}`}
                      placeholder="값 입력"
                      onFocus={() => selection.focus({ rowId: row.id, columnId: column.id })}
                      onPaste={(event) => onPaste(event, row.id, column.id)}
                      onChange={(event) => void onUpdateCell(column.id, row.id, event.target.value)}
                    />
                  )}
                  <CellImageControl
                    image={image}
                    onSelect={(file) => onUploadCellImage(column, row.id, file)}
                    onPreview={() => onPreviewCellImage(column, row.id)}
                    onClear={() => onClearCellImage(column, row.id)}
                  />
                </div>
              </div>
            );
          })}
          <div className="sheetCell emptyAddColumnCell" />
        </Fragment>
      ))}

      <div className="sheetCell addRowLabel stickyCol">
        <button className="addSheetButton" type="button" onClick={() => void onAddRow()}>
          <Plus size={16} />항목 추가
        </button>
      </div>
      {columns.map((column) => (
        <div className="sheetCell addRowCell" key={`${column.id}-add-row`} />
      ))}
      <div className="sheetCell emptyAddColumnCell" />
    </>
  );
}
