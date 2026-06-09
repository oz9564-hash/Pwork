import type { ColumnPdfAdjust, PdfArea } from "../../types";

/** 기준 영역에 이 열의 전체 오프셋 + 개별 보정을 더한 정규화 좌표(0~1)를 돌려준다. */
export function effectiveAreaPosition(area: PdfArea, adjust?: ColumnPdfAdjust) {
  const override = adjust?.overrides?.[area.id];
  const dx = (adjust?.dx ?? 0) + (override?.dx ?? 0);
  const dy = (adjust?.dy ?? 0) + (override?.dy ?? 0);
  return { x: area.x + dx, y: area.y + dy };
}

/** pdf-lib 페이지 좌표계(원점=좌하단)의 사각형. */
export type PageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 정규화 영역 + 보정을 실제 pdf-lib 페이지 좌표(원점 좌하단)로 변환한다.
 * 화면/저장값은 좌상단 기준이라 y축을 뒤집는다. 렌더와 미리보기가 이 한 함수를 공유한다.
 */
export function toPageRect(
  area: PdfArea,
  adjust: ColumnPdfAdjust | undefined,
  pageWidth: number,
  pageHeight: number,
): PageRect {
  const pos = effectiveAreaPosition(area, adjust);
  const width = area.width * pageWidth;
  const height = area.height * pageHeight;
  const boxTop = pos.y * pageHeight;
  return {
    x: pos.x * pageWidth,
    y: pageHeight - boxTop - height,
    width,
    height,
  };
}
