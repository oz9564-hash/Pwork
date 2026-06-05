import { useRef } from "react";
import type { ChangeEvent } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { CellImageAsset } from "../types";

type ImageSize = {
  width: number;
  height: number;
};

type CellImageControlProps = {
  image?: CellImageAsset;
  onSelect: (file: File, size: ImageSize) => void | Promise<void>;
  onClear: () => void | Promise<void>;
};

export function CellImageControl({ image, onSelect, onClear }: CellImageControlProps) {
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

    const size = await readImageSize(file);
    await onSelect(file, size);
  }

  return (
    <>
      {image ? (
        <button className="cellImageBadge" type="button" title={`${image.name} 삭제`} onClick={() => void onClear()}>
          <ImageIcon size={14} />
          이미지
        </button>
      ) : (
        <button
          className="cellImageButton"
          type="button"
          title="이미지 넣기"
          onClick={() => inputRef.current?.click()}
        >
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

function readImageSize(file: File): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 크기를 읽지 못했습니다."));
    };
    image.src = url;
  });
}
