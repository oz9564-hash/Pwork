/**
 * 문서 단위로 저장을 디바운스한다. 같은 key로 짧은 간격에 들어온 변경은
 * 마지막 값 하나만 Firestore에 쓰여 쓰기 횟수와 경합(stale write)을 줄인다.
 *
 * - schedule(key, value): 저장을 예약(기존 예약은 덮어씀)
 * - flush(key): 예약된 저장을 즉시 실행
 * - cancel(key): 예약을 취소(즉시 전체 문서를 쓰는 다른 경로가 최신 상태를 이미 반영할 때 사용)
 * - bypass(keys, action): 해당 key들의 예약을 취소한 뒤 즉시 쓰기 action을 실행한다.
 *   디바운스를 우회해 전체 문서를 쓰는 경로는 전부 이걸 거쳐야 한다.
 *   (cancel 호출을 빼먹어 디바운스가 나중에 stale 값을 덮어쓰는 버그를 구조적으로 차단)
 * - flushAll(): 모든 예약을 즉시 실행(언마운트/페이지 종료 시)
 */
export function createDebouncedSaver<T>(
  saveFn: (value: T) => Promise<void>,
  options: { delay?: number; onError?: (error: unknown) => void } = {},
) {
  const { delay = 600, onError } = options;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, T>();

  function schedule(key: string, value: T) {
    pending.set(key, value);
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        void flush(key);
      }, delay),
    );
  }

  async function flush(key: string) {
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
    if (!pending.has(key)) return;
    const value = pending.get(key) as T;
    pending.delete(key);
    try {
      await saveFn(value);
    } catch (error) {
      // 저장 실패가 unhandled rejection으로 사라지지 않게 잡아 알린다.
      console.error("[debounced-save] failed", error);
      onError?.(error);
    }
  }

  function cancel(key: string) {
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
    pending.delete(key);
  }

  async function bypass<R>(keys: string | string[], action: () => Promise<R>): Promise<R> {
    for (const key of Array.isArray(keys) ? keys : [keys]) cancel(key);
    return action();
  }

  async function flushAll() {
    await Promise.all([...timers.keys()].map((key) => flush(key)));
  }

  return { schedule, flush, cancel, bypass, flushAll };
}
