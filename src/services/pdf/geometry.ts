import type { ColumnPdfAdjust, PdfArea } from "../../types";

/** 기준 영역 + 열별 보정(위치·크기)을 합친 최종 정규화 영역(0~1). */
export type ResolvedArea = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

/**
 * 기준 영역에 이 열의 개별 보정(영역별 위치 오프셋 + 크기 덮어쓰기)을
 * 반영한 최종 영역을 돌려준다. UI와 렌더러가 공유하는 단일 소스.
 *
 * 열별 속성(fontSize 등)을 추가할 때도 여기 한 곳만 확장하면 된다.
 */
export function resolveArea(area: PdfArea, adjust?: ColumnPdfAdjust): ResolvedArea {
  const override = adjust?.overrides?.[area.id];
  return {
    x: area.x + (override?.dx ?? 0),
    y: area.y + (override?.dy ?? 0),
    width: override?.width ?? area.width,
    height: override?.height ?? area.height,
    fontSize: area.fontSize,
  };
}

/** 기준 영역에 보정을 더한 정규화 위치(x/y)만 필요한 경우. */
export function effectiveAreaPosition(area: PdfArea, adjust?: ColumnPdfAdjust) {
  const { x, y } = resolveArea(area, adjust);
  return { x, y };
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
  const resolved = resolveArea(area, adjust);
  const width = resolved.width * pageWidth;
  const height = resolved.height * pageHeight;
  const boxTop = resolved.y * pageHeight;
  return {
    x: resolved.x * pageWidth,
    y: pageHeight - boxTop - height,
    width,
    height,
  };
}
