import { PDFDocument, StandardFonts } from "pdf-lib";
import type { FontAsset } from "../../types";

/** 사용자 지정 폰트를 임베드한다. 실패하면 기본 폰트로 폴백. */
export async function embedUsableFont(pdfDocument: PDFDocument, fontAsset?: FontAsset) {
  if (fontAsset) {
    try {
      // subset: false — pdf-lib의 서브셋터가 한글 TTF에서 글리프를 간헐적으로 누락시켜
      // 일부 글자가 빈 칸으로 출력되는 버그가 있다. 용량(수 MB)을 감수하고 전체 임베드한다.
      const font = await pdfDocument.embedFont(await fontAsset.file.arrayBuffer(), { subset: false });
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
      // 사용자 폰트와 같은 이유로 subset 비활성(한글 글리프 누락 버그).
      const font = await pdfDocument.embedFont(await response.arrayBuffer(), { subset: false });
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
