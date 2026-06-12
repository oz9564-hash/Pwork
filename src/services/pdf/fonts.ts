import { PDFDocument, StandardFonts } from "pdf-lib";
import type { FontAsset } from "../../types";

/** 사용자 지정 폰트를 임베드한다. 실패하면 기본 폰트로 폴백. */
export async function embedUsableFont(pdfDocument: PDFDocument, fontAsset?: FontAsset) {
  if (fontAsset) {
    try {
      // subset: true → 실제 사용된 글리프만 임베드한다. 한글 TTF는 수 MB라
      // 전체 임베드 시 결과 PDF가 비대해지고 생성도 느려진다.
      const font = await pdfDocument.embedFont(await fontAsset.file.arrayBuffer(), { subset: true });
      font.widthOfTextAtSize("test", 12);
      console.log("[diag:font] embedded custom uploaded font", { name: fontAsset.name });
      return font;
    } catch (error) {
      console.error("[pdf-download] custom font failed, fallback to default font", error);
    }
  }

  console.log("[diag:font] no custom font, using default candidates");
  return embedDefaultFont(pdfDocument);
}

async function embedDefaultFont(pdfDocument: PDFDocument) {
  const candidates = ["fonts/human-myeongjo.ttf", "fonts/malgun.ttf"];

  for (const path of candidates) {
    try {
      const url = `${import.meta.env.BASE_URL}${path}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.warn("[diag:font] default candidate fetch not ok", { url, status: response.status });
        continue;
      }
      const font = await pdfDocument.embedFont(await response.arrayBuffer(), { subset: true });
      font.widthOfTextAtSize("test", 12);
      console.log("[diag:font] embedded default candidate", { path });
      return font;
    } catch (error) {
      console.error("[pdf-download] default font candidate failed", { path, error });
      continue;
    }
  }

  console.warn("[diag:font] ALL Korean candidates failed → Helvetica (no Korean glyphs)");
  return pdfDocument.embedFont(StandardFonts.Helvetica);
}
