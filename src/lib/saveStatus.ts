import { useSyncExternalStore } from "react";

/**
 * 전역 저장 상태. 상단바 "저장 중…/저장됨" 표시에 쓴다.
 * - saving: 쓰기가 진행 중
 * - error:  마지막 쓰기 실패
 * - unsaved: 편집은 했지만 아직 기록 전(디바운스 대기/블러 전)
 * - saved:  대기·진행 중인 쓰기 없음
 */
export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

/**
 * 여러 디바운스 saver가 함께 보고하는 단일 상태 저장소.
 * pending은 key 기반(Set)이라 같은 문서를 다시 예약해도 중복 집계되지 않는다.
 */
function createStore() {
  const pendingKeys = new Set<string>();
  let inFlight = 0;
  let errored = false;
  const listeners = new Set<() => void>();
  let snapshot: SaveStatus = "saved";

  function compute(): SaveStatus {
    if (inFlight > 0) return "saving";
    if (errored) return "error";
    if (pendingKeys.size > 0) return "unsaved";
    return "saved";
  }

  function refresh() {
    const next = compute();
    if (next !== snapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    /** 편집이 예약됨(아직 기록 전). */
    markPending(key: string) {
      pendingKeys.add(key);
      errored = false;
      refresh();
    },
    /** 예약이 기록되었거나 취소됨. */
    clearPending(key: string) {
      pendingKeys.delete(key);
      refresh();
    },
    beginWrite() {
      inFlight += 1;
      errored = false;
      refresh();
    },
    endWrite(ok: boolean) {
      inFlight = Math.max(0, inFlight - 1);
      if (!ok) errored = true;
      refresh();
    },
  };
}

export type SaveStatusStore = ReturnType<typeof createStore>;

/** 앱 전역 단일 인스턴스. 모든 saver가 이 저장소에 보고한다. */
export const saveStatusStore = createStore();

/** React 컴포넌트에서 현재 저장 상태를 구독한다. */
export function useSaveStatus(store: SaveStatusStore = saveStatusStore): SaveStatus {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
