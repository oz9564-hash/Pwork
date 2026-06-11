/**
 * 영속화 호출을 감싸 실패 시 onError를 부르고 성공 여부를 boolean으로 돌려준다.
 * 호출부는 이 반환값으로 낙관적 상태 갱신을 "저장 성공 후"로 미뤄
 * 화면과 DB의 불일치(유령 데이터)를 막는다.
 */
export async function persist(action: () => Promise<unknown>, onError: () => void): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    console.error("[persist] failed", error);
    onError();
    return false;
  }
}
