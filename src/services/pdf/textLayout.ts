/** 줄 간격 배수 (글자 크기 × 이 값 = 한 줄 높이). */
export const LINE_HEIGHT = 1.35;

/**
 * 주어진 폭에 맞춰 텍스트를 여러 줄로 끊는다.
 * - 명시적 줄바꿈(\n)은 그대로 보존
 * - 글자 단위로 폭을 확인해 한글처럼 공백이 적은 문장도 자연스럽게 내려간다.
 *
 * measure는 호출자가 실제 사용할 폰트의 폭 측정 함수를 넘긴다
 * (렌더러는 font.widthOfTextAtSize). 이렇게 해야 줄바꿈 위치 = 실제 출력.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    lines.push(...wrapParagraph(paragraph, maxWidth, measure));
  }
  return lines;
}

function wrapParagraph(paragraph: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (paragraph === "") return [""];
  if (maxWidth <= 0) return [paragraph];

  const lines: string[] = [];
  let line = "";

  for (const ch of Array.from(paragraph)) {
    const next = line + ch;
    if (measure(next) <= maxWidth) {
      line = next;
      continue;
    }

    if (line) {
      lines.push(line.replace(/\s+$/, ""));
    }
    line = /\s/.test(ch) ? "" : ch;
  }

  lines.push(line.replace(/\s+$/, ""));
  return lines.length ? lines : [""];
}
