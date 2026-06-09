import type { AreaRenderer } from "./types";

/**
 * 이미지 셀을 영역 박스 안에 비율 유지(contain)로 그린다. 가운데 정렬, 찌그러짐 없음.
 * 화면 오버레이의 `object-fit: contain`과 동일한 결과 → 미리보기 = 출력.
 */
export const imageRenderer: AreaRenderer = {
  kind: "image",
  async render({ doc, page, rect, imageFile }) {
    if (!imageFile) return;

    const imageBytes = await imageFile.arrayBuffer();
    const image =
      imageFile.type === "image/png"
        ? await doc.embedPng(imageBytes)
        : await doc.embedJpg(imageBytes);

    // 박스 안에 들어가는 최대 배율(가로/세로 중 작은 쪽)로 맞춰 비율 유지.
    const scale = Math.min(rect.width / image.width, rect.height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;

    page.drawImage(image, {
      x: rect.x + (rect.width - drawWidth) / 2,
      y: rect.y + (rect.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  },
};
