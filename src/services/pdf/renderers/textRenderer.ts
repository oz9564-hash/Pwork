import { rgb } from "pdf-lib";
import { fitText } from "../textFit";
import { LINE_HEIGHT } from "../textLayout";
import type { AreaRenderer } from "./types";

/**
 * 텍스트 셀을 그린다. fitText가 박스와 맞춤 모드에 맞춰 줄과 글자 크기를 계산한다.
 * 줄바꿈 위치는 실제 임베드 폰트 폭으로 계산하므로 미리보기(실제 PDF 렌더) = 출력이 보장된다.
 */
export const textRenderer: AreaRenderer = {
  kind: "text",
  render({ page, rect, fontSize, textFitMode, column, row, font }) {
    const text = column.values[row.id] ?? "";
    if (!text) return;

    const fit = fitText({
      text,
      mode: textFitMode,
      maxWidth: rect.width,
      maxHeight: rect.height,
      maxFontSize: fontSize,
      measure: (value, size) => font.widthOfTextAtSize(value, size),
    });

    const size = fit.fontSize;
    const lineGap = size * LINE_HEIGHT;
    // 위치 기준은 박스 "상단" 고정. fitText가 계산한 줄과 크기를 그대로 그린다.
    const boxTop = rect.y + rect.height; // 박스 상단(pdf y, 원점 좌하단)
    const lines = fit.lines;

    // [diag] 출력 텍스트 렌더(한 줄 문자열, 콘솔 잘림 방지).
    console.log(
      `[diag:textRender] "${text}" size=${size} rect x=${rect.x.toFixed(1)} y=${rect.y.toFixed(1)} ` +
        `w=${rect.width.toFixed(1)} h=${rect.height.toFixed(1)} ` +
        `right=${(rect.x + rect.width).toFixed(1)} mode=${textFitMode} fitSize=${size.toFixed(2)} ` +
        `lineCount=${lines.length} lines=${JSON.stringify(lines)} ` +
        `textW=${font.widthOfTextAtSize(text, size).toFixed(1)}`,
    );

    // 첫 줄 베이스라인 = 박스 상단에서 글자 크기만큼 내린 위치. 이후 줄은 아래로.
    let y = boxTop - size;
    for (const line of lines) {
      if (line) {
        page.drawText(line, { x: rect.x, y, size, font, color: rgb(0, 0, 0) });
      }
      y -= lineGap;
    }
  },
};
