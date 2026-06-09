import { rgb } from "pdf-lib";
import type { AreaRenderer } from "./types";

/** 텍스트 셀을 한 줄로 그린다. 영역 너비를 넘으면 글자 크기를 줄여 맞춘다. */
export const textRenderer: AreaRenderer = {
  kind: "text",
  render({ page, area, rect, column, row, font }) {
    const text = column.values[row.id] ?? "";
    if (!text) return;

    let size = area.fontSize;
    const measured = font.widthOfTextAtSize(text, size);
    if (measured > rect.width && measured > 0) {
      size = Math.max(4, size * (rect.width / measured));
    }
    // rect.y는 박스 하단. 텍스트 베이스라인은 박스 상단에서 글자 크기만큼 내린 위치.
    const y = rect.y + rect.height - size;

    page.drawText(text, {
      x: rect.x,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  },
};
