import type { TextFitMode } from "../../types";
import { LINE_HEIGHT, wrapText } from "./textLayout";

export const DEFAULT_TEXT_FIT_MODE: TextFitMode = "wrap";
export const MIN_TEXT_FIT_FONT_SIZE = 0.1;
const MAX_AUTO_TEXT_FIT_FONT_SIZE = 96;

type TextFitOptions = {
  text: string;
  mode?: TextFitMode;
  maxWidth: number;
  maxHeight: number;
  maxFontSize: number;
  minFontSize?: number;
  lineHeight?: number;
  measure: (text: string, fontSize: number) => number;
};

export type TextFitResult = {
  fontSize: number;
  lines: string[];
  overflow: boolean;
};

export function fitText({
  text,
  mode = DEFAULT_TEXT_FIT_MODE,
  maxWidth,
  maxHeight,
  maxFontSize,
  minFontSize = MIN_TEXT_FIT_FONT_SIZE,
  lineHeight = LINE_HEIGHT,
  measure,
}: TextFitOptions): TextFitResult {
  const min = Math.max(0.1, minFontSize);
  const max = Math.max(min, Number.isFinite(maxFontSize) ? maxFontSize : min);

  if (!text) return { fontSize: max, lines: [], overflow: false };
  if (maxWidth <= 0 || maxHeight <= 0) {
    return { ...layoutText(text, mode, maxWidth, min, measure), overflow: true };
  }

  if (mode === "singleLine") {
    return fitSingleLineText(text, maxWidth, maxHeight, max, min, lineHeight, measure);
  }

  return fitWrappedText(text, maxWidth, maxHeight, max, min, lineHeight, measure);
}

function fitSingleLineText(
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxFontSize: number,
  minFontSize: number,
  lineHeight: number,
  measure: (text: string, fontSize: number) => number,
): TextFitResult {
  const line = toSingleLine(text);
  const widthAtMax = measure(line, maxFontSize);
  const widthFitSize = widthAtMax > 0 ? (maxFontSize * maxWidth) / widthAtMax : maxFontSize;
  const heightFitSize = maxHeight / lineHeight;
  const target = Math.min(widthFitSize, heightFitSize);
  const fontSize = Math.max(minFontSize, target);
  const overflow = measure(line, fontSize) > maxWidth + 0.01 || fontSize * lineHeight > maxHeight + 0.01;

  return { fontSize, lines: [line], overflow };
}

function fitWrappedText(
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxFontSize: number,
  minFontSize: number,
  lineHeight: number,
  measure: (text: string, fontSize: number) => number,
): TextFitResult {
  const autoMaxFontSize = Math.min(
    MAX_AUTO_TEXT_FIT_FONT_SIZE,
    Math.max(maxFontSize, maxHeight / lineHeight, minFontSize),
  );

  const maxLayout = layoutText(text, "wrap", maxWidth, autoMaxFontSize, measure);
  if (fits(maxLayout, maxWidth, maxHeight, lineHeight, measure)) {
    return { ...maxLayout, overflow: false };
  }

  const minLayout = layoutText(text, "wrap", maxWidth, minFontSize, measure);
  if (!fits(minLayout, maxWidth, maxHeight, lineHeight, measure)) {
    return { ...minLayout, overflow: true };
  }

  let low = minFontSize;
  let high = autoMaxFontSize;
  let best = minLayout;

  for (let index = 0; index < 14; index += 1) {
    const mid = (low + high) / 2;
    const next = layoutText(text, "wrap", maxWidth, mid, measure);
    if (fits(next, maxWidth, maxHeight, lineHeight, measure)) {
      best = next;
      low = mid;
    } else {
      high = mid;
    }
  }

  return { ...best, overflow: false };
}

function layoutText(
  text: string,
  mode: TextFitMode,
  maxWidth: number,
  fontSize: number,
  measure: (text: string, fontSize: number) => number,
): Omit<TextFitResult, "overflow"> {
  if (mode === "singleLine") {
    return { fontSize, lines: [toSingleLine(text)] };
  }

  return {
    fontSize,
    lines: wrapText(text, maxWidth, (value) => measure(value, fontSize)),
  };
}

function fits(
  layout: Omit<TextFitResult, "overflow">,
  maxWidth: number,
  maxHeight: number,
  lineHeight: number,
  measure: (text: string, fontSize: number) => number,
) {
  const epsilon = 0.01;
  const height = layout.lines.length * layout.fontSize * lineHeight;
  return (
    height <= maxHeight + epsilon &&
    layout.lines.every((line) => measure(line, layout.fontSize) <= maxWidth + epsilon)
  );
}

function toSingleLine(text: string) {
  return text.replace(/\s*\r?\n\s*/g, " ");
}
