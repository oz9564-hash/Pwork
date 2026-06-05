import { useRef } from "react";
import type { ChangeEvent } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import type { CellImageAsset } from "../types";

type CellImageControlProps = {
  image?: CellImageAsset;
  onSelect: (file: File) => void | Promise<void>;
  onPreview: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
};

export function CellImageControl({ image, onSelect, onPreview, onClear }: CellImageControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (!(file.type === "image/png" || file.type === "image/jpeg")) {
      window.alert("PNG 또는 JPG 이미지만 넣을 수 있습니다.");
      return;
    }

    await onSelect(file);
  }

  return (
    <>
      {image ? (
        <div className="cellImageCard">
          <button className="cellImagePreviewButton" type="button" title={image.name} onClick={() => void onPreview()}>
            <ImageIcon size={14} />
            <span>{image.name || "이미지"}</span>
          </button>
          <button
            className="cellImageRemoveButton"
            type="button"
            title="이미지 삭제"
            onClick={(event) => {
              event.stopPropagation();
              void onClear();
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button className="cellImageButton" type="button" title="이미지 넣기" onClick={() => inputRef.current?.click()}>
          <ImageIcon size={14} />
        </button>
      )}
      <input
        ref={inputRef}
        className="cellImageInput"
        type="file"
        accept="image/png,image/jpeg"
        onChange={(event) => void handleFileChange(event)}
      />
    </>
  );
}
