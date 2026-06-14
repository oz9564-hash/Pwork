import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useSaveStatus } from "../lib/saveStatus";

const LABELS = {
  saved: "모든 변경사항 저장됨",
  saving: "저장 중…",
  unsaved: "저장 대기 중",
  error: "저장 실패",
} as const;

/** 상단바에 현재 저장 상태를 표시한다(Google Docs식). 전역 saveStatusStore를 구독. */
export function SaveStatusIndicator() {
  const status = useSaveStatus();

  return (
    <span className={`saveStatus saveStatus-${status}`} role="status" aria-live="polite">
      {status === "saving" ? (
        <Loader2 size={14} className="saveStatusSpin" />
      ) : status === "error" ? (
        <CloudOff size={14} />
      ) : status === "unsaved" ? (
        <RefreshCw size={14} />
      ) : (
        <Check size={14} />
      )}
      {LABELS[status]}
    </span>
  );
}
