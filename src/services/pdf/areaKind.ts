import type { PdfArea, PdfAreaKind, ValueColumn } from "../../types";

/**
 * 영역의 렌더 타입을 결정한다. UI와 렌더러가 공유하는 단일 소스.
 *
 * 타입은 영역(PdfArea)의 고정 속성이 아니라 (영역 row × 열 셀 내용)에서 파생된다.
 * 같은 영역도 이미지가 올라간 열에선 image, 텍스트만 있는 열에선 text가 된다.
 * 단, area.kind가 명시돼 있으면 그것을 우선한다.
 */
export function resolveAreaKind(area: PdfArea, column?: ValueColumn): PdfAreaKind {
  if (area.kind) return area.kind;
  if (column?.images?.[area.rowId]) return "image";
  return "text";
}
