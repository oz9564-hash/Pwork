import type { PdfAreaKind } from "../../../types";
import { imageRenderer } from "./imageRenderer";
import { textRenderer } from "./textRenderer";
import type { AreaRenderer } from "./types";

const RENDERERS: Record<PdfAreaKind, AreaRenderer> = {
  text: textRenderer,
  image: imageRenderer,
};

export function getRenderer(kind: PdfAreaKind): AreaRenderer {
  return RENDERERS[kind];
}

export type { AreaRenderer, AreaRenderContext } from "./types";
