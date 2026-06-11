import { Loader2, X } from "lucide-react";

export type BusyFeedback = {
  title: string;
  description: string;
};

export type CellImagePreview = {
  name: string;
  url: string;
};

export type UploadNotice = {
  tone: "success" | "error";
  title: string;
  description: string;
};

type Props = {
  busyFeedback?: BusyFeedback;
  uploadNotice?: UploadNotice;
  imagePreview?: CellImagePreview;
  onCloseImagePreview: () => void;
};

/** 화면 위에 떠 있는 상태 표시 3종: 이미지 미리보기 모달 · 블로킹 작업 오버레이 · 토스트. */
export function StatusOverlays({ busyFeedback, uploadNotice, imagePreview, onCloseImagePreview }: Props) {
  return (
    <>
      {imagePreview ? (
        <div className="modalBackdrop imagePreviewBackdrop" role="dialog" aria-modal="true" aria-label={imagePreview.name}>
          <div className="imagePreviewModal">
            <header className="imagePreviewHeader">
              <strong>{imagePreview.name}</strong>
              <button className="iconButton" type="button" title="닫기" onClick={onCloseImagePreview}>
                <X size={18} />
              </button>
            </header>
            <div className="imagePreviewBody">
              <img src={imagePreview.url} alt={imagePreview.name} />
            </div>
          </div>
        </div>
      ) : null}
      {busyFeedback ? (
        <div className="downloadOverlay" role="status" aria-live="polite">
          <div className="downloadDialog">
            <Loader2 className="spinIcon" size={28} />
            <strong>{busyFeedback.title}</strong>
            <span>{busyFeedback.description}</span>
          </div>
        </div>
      ) : null}
      {uploadNotice ? (
        <div className={`uploadToast ${uploadNotice.tone}`} role="status" aria-live="polite">
          <strong>{uploadNotice.title}</strong>
          <span>{uploadNotice.description}</span>
        </div>
      ) : null}
    </>
  );
}
