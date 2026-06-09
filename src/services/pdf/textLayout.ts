/** 줄 간격 배수 (글자 크기 × 이 값 = 한 줄 높이). */
export const LINE_HEIGHT = 1.35;

/**
 * 주어진 폭에 맞춰 텍스트를 여러 줄로 끊는다.
 * - 명시적 줄바꿈(\n)은 그대로 보존
 * - 공백 단위로 끊되, 한 단어가 폭을 넘으면 글자 단위로 분해(한글 등 공백 없는 문자열 대응)
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
  // 공백 묶음과 단어 묶음을 토큰으로 분리(공백 보존).
  const tokens = paragraph.match(/\s+|\S+/g) ?? [];
  let line = "";

  for (const token of tokens) {
    if (measure(line + token) <= maxWidth) {
      line += token;
      continue;
    }
    // 폭 초과
    if (/^\s+$/.test(token)) {
      // 줄 끝 공백이 넘침 → 그냥 줄바꿈
      if (line) lines.push(line.replace(/\s+$/, ""));
      line = "";
      continue;
    }
    if (line && measure(token) <= maxWidth) {
      // 현재 줄을 닫고 단어를 다음 줄로
      lines.push(line.replace(/\s+$/, ""));
      line = token;
      continue;
    }
    // 단어 자체가 폭보다 넓음(또는 빈 줄) → 글자 단위 분해
    for (const ch of token) {
      if (line && measure(line + ch) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }

  lines.push(line.replace(/\s+$/, ""));
  return lines.length ? lines : [""];
}
