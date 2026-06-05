type OptimizedImage = {
  file: Blob;
  name: string;
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
};

const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export async function optimizeImageFile(file: File): Promise<OptimizedImage> {
  const source = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 처리하지 못했습니다.");

  context.drawImage(source.image, 0, 0, width, height);

  const hasAlpha = file.type === "image/png" && imageHasAlpha(context, width, height);
  const contentType = hasAlpha ? "image/png" : "image/jpeg";
  const optimized = await canvasToBlob(canvas, contentType, contentType === "image/jpeg" ? JPEG_QUALITY : undefined);

  return {
    file: optimized.size < file.size ? optimized : file,
    name: file.name,
    contentType: optimized.size < file.size ? contentType : (file.type as "image/png" | "image/jpeg"),
    width: optimized.size < file.size ? width : source.width,
    height: optimized.size < file.size ? height : source.height,
  };
}

function loadImage(file: File): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 크기를 읽지 못했습니다."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 압축하지 못했습니다."))), type, quality);
  });
}

function imageHasAlpha(context: CanvasRenderingContext2D, width: number, height: number) {
  const data = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}
