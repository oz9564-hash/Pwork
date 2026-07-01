import { useState } from "react";
import { LogOut, Users } from "lucide-react";

type Props = {
  userEmail?: string | null;
  onSubmit: (category: string) => Promise<void> | void;
  onSignOut: () => void;
};

/**
 * 첫 로그인 시 소속 카테고리(팀)를 입력받는 화면. 같은 카테고리를 가진 사용자끼리 워크스페이스를 공유한다.
 * 프로필 저장 후에는 다시 보이지 않는다.
 */
export function CategorySetup({ userEmail, onSubmit, onSignOut }: Props) {
  const [category, setCategory] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    const value = category.trim();
    if (!value || pending) return;
    setPending(true);
    try {
      await onSubmit(value);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="authShell">
      <div className="authCard">
        <span className="brandMark" aria-hidden="true">
          <Users size={24} />
        </span>
        <h1>소속 카테고리 입력</h1>
        <p>
          같은 카테고리를 입력한 사람끼리 워크스페이스를 공유합니다.
          {userEmail ? ` (${userEmail})` : ""}
        </p>
        <input
          className="workspaceCreateInput"
          type="text"
          value={category}
          placeholder="예: edu3"
          maxLength={40}
          autoFocus
          disabled={pending}
          onChange={(event) => setCategory(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSubmit();
          }}
        />
        <button
          className="button primary full"
          type="button"
          disabled={pending || !category.trim()}
          onClick={() => void handleSubmit()}
        >
          {pending ? "저장 중…" : "시작하기"}
        </button>
        <button className="button ghost" type="button" disabled={pending} onClick={onSignOut}>
          <LogOut size={16} />
          로그아웃
        </button>
      </div>
    </main>
  );
}
