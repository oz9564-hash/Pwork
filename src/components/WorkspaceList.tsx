import { useState } from "react";
import { Check, FileText, FolderOpen, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Workspace } from "../types";

type Props = {
  workspaces: Workspace[];
  category?: string;
  userEmail?: string | null;
  onOpen: (workspace: Workspace) => void;
  onCreate: (name: string) => Promise<void> | void;
  onRename: (workspace: Workspace, name: string) => Promise<void> | void;
  onDelete: (workspace: Workspace) => Promise<void> | void;
  onSignOut: () => void;
};

/**
 * 로그인 직후 보이는 워크스페이스 목록 화면. 경로/저장 로직은 없고 repository 호출 콜백만 받는다.
 * 카드 클릭으로 열고, 이름 변경(인라인)·삭제·생성이 가능하다.
 */
export function WorkspaceList({
  workspaces,
  category,
  userEmail,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onSignOut,
}: Props) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [draftName, setDraftName] = useState("");
  const [pending, setPending] = useState(false);

  async function runPending(action: () => Promise<void> | void) {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } finally {
      setPending(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    await runPending(async () => {
      await onCreate(name);
      setNewName("");
    });
  }

  function startEdit(workspace: Workspace) {
    setEditingId(workspace.id);
    setDraftName(workspace.name);
  }

  function cancelEdit() {
    setEditingId(undefined);
    setDraftName("");
  }

  async function commitEdit(workspace: Workspace) {
    const name = draftName.trim();
    if (!name || name === workspace.name) {
      cancelEdit();
      return;
    }
    await runPending(async () => {
      await onRename(workspace, name);
      cancelEdit();
    });
  }

  async function handleDelete(workspace: Workspace) {
    const confirmed = window.confirm(
      `'${workspace.name}' 워크스페이스를 삭제할까요?\n이 워크스페이스의 표·이미지·PDF가 모두 삭제됩니다. 되돌릴 수 없습니다.`,
    );
    if (!confirmed) return;
    await runPending(() => onDelete(workspace));
  }

  return (
    <main className="workspaceShell">
      <header className="workspaceTopBar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            <FileText size={20} />
          </span>
          <div className="brandText">
            <h1>
              워크스페이스
              {category ? <span className="categoryChip">{category}</span> : null}
            </h1>
            <p>
              {category
                ? `${category} 팀이 함께 쓰는 작업 세트예요. 골라서 열거나 새로 만드세요.`
                : "작업 세트를 골라 열거나 새로 만드세요."}
            </p>
          </div>
        </div>
        <button
          className="iconButton"
          type="button"
          title={`${userEmail ?? "사용자"} 로그아웃`}
          onClick={onSignOut}
        >
          <LogOut size={16} />
        </button>
      </header>

      <section className="workspacePanel">
        <div className="workspaceCreate">
          <input
            className="workspaceCreateInput"
            type="text"
            value={newName}
            placeholder="새 워크스페이스 이름"
            maxLength={60}
            disabled={pending}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreate();
            }}
          />
          <button
            className="button primary"
            type="button"
            disabled={pending || !newName.trim()}
            onClick={() => void handleCreate()}
          >
            <Plus size={16} />
            만들기
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className="workspaceEmpty">
            <FolderOpen size={26} />
            <span>아직 워크스페이스가 없습니다.</span>
            <span className="workspaceEmptyHint">위 입력창에 이름을 적고 “만들기”를 눌러 시작하세요.</span>
          </div>
        ) : (
          <ul className="workspaceGrid">
            {workspaces.map((workspace) => {
              const isEditing = editingId === workspace.id;
              return (
                <li key={workspace.id} className={`workspaceCard${isEditing ? " isEditing" : ""}`}>
                  {isEditing ? (
                    <div className="workspaceCardEdit">
                      <input
                        className="workspaceCreateInput"
                        type="text"
                        value={draftName}
                        maxLength={60}
                        autoFocus
                        disabled={pending}
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitEdit(workspace);
                          if (event.key === "Escape") cancelEdit();
                        }}
                      />
                      <button
                        className="workspaceCardAction confirm"
                        type="button"
                        title="이름 저장"
                        disabled={pending}
                        onClick={() => void commitEdit(workspace)}
                      >
                        <Check size={16} />
                      </button>
                      <button className="workspaceCardAction" type="button" title="취소" onClick={cancelEdit}>
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="workspaceCardOpen"
                        type="button"
                        disabled={pending}
                        onClick={() => onOpen(workspace)}
                      >
                        <span className="workspaceCardIcon" aria-hidden="true">
                          <FolderOpen size={18} />
                        </span>
                        <span className="workspaceCardName">{workspace.name}</span>
                      </button>
                      <div className="workspaceCardActions">
                        <button
                          className="workspaceCardAction"
                          type="button"
                          title="이름 변경"
                          disabled={pending}
                          onClick={() => startEdit(workspace)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="workspaceCardAction danger"
                          type="button"
                          title="삭제"
                          disabled={pending}
                          onClick={() => void handleDelete(workspace)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
