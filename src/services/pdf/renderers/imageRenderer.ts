import type { AreaRenderer } from "./types";

/** 이미지 셀을 영역 사각형에 맞춰 그린다. */
export const imageRenderer: AreaRenderer = {
  kind: "image",
  async render({ doc, page, rect, imageFile }) {
    if (!imageFile) return;

    const imageBytes = await imageFile.arrayBuffer();
    const image =
      imageFile.type === "image/png"
        ? await doc.embedPng(imageBytes)
        : await doc.embedJpg(imageBytes);

    page.drawImage(image, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  },
};
