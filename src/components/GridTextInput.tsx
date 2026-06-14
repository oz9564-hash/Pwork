import type { ClipboardEvent, KeyboardEvent } from "react";

type Props = {
  value: string;
  /** 키 입력마다 로컬 state만 갱신(네트워크 X). */
  onChange: (value: string) => void;
  /** 편집 확정 시 호출 → 해당 문서 1건 즉시 저장. blur와 Enter에서 발생. */
  onCommit: () => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  onFocus?: () => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
};

/**
 * 그리드용 텍스트 입력 모듈. "로컬 편집 + 커밋(blur/Enter) 시 저장" 패턴을 캡슐화한다.
 * 셀 값·항목 라벨·열 이름 입력이 이 한 컴포넌트를 공유해 저장 타이밍을 일관되게 만든다.
 * - 타이핑: onChange로 로컬 state만 갱신(쓰기 비용 없음)
 * - blur / Enter: onCommit으로 그 문서만 즉시 Firestore에 기록
 *   (변경이 없으면 saver.flush가 no-op이라 불필요한 쓰기는 발생하지 않는다)
 */
export function GridTextInput({
  value,
  onChange,
  onCommit,
  className,
  placeholder,
  ariaLabel,
  onFocus,
  onPaste,
}: Props) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      // blur가 onCommit을 부른다(중복 저장 방지: Enter에서 직접 부르지 않음).
      event.currentTarget.blur();
    }
  }

  return (
    <input
      className={className}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onFocus={onFocus}
      onPaste={onPaste}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={handleKeyDown}
    />
  );
}
