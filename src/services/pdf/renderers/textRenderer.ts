import { rgb } from "pdf-lib";
import { LINE_HEIGHT, wrapText } from "../textLayout";
import type { AreaRenderer } from "./types";

/**
 * 텍스트 셀을 그린다. 글자 크기는 유지하고, 영역 폭을 넘으면 다음 줄로 자동 줄바꿈한다.
 * 줄바꿈 위치는 실제 임베드 폰트 폭으로 계산하므로 미리보기(실제 PDF 렌더) = 출력이 보장된다.
 */
export const textRenderer: AreaRenderer = {
  kind: "text",
  render({ page, area, rect, column, row, font }) {
    const text = column.values[row.id] ?? "";
    if (!text) return;

    const size = area.fontSize;
    const lines = wrapText(text, rect.width, (s) => font.widthOfTextAtSize(s, size));
    const lineGap = size * LINE_HEIGHT;

    // 첫 줄 베이스라인 = 박스 상단에서 글자 크기만큼 내린 위치. 이후 줄은 아래로.
    let y = rect.y + rect.height - size;
    for (const line of lines) {
      if (line) {
        page.drawText(line, { x: rect.x, y, size, font, color: rgb(0, 0, 0) });
      }
      y -= lineGap;
    }
  },
};
