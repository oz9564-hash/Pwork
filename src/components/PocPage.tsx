import { ArrowLeft, FlaskConical, Plus } from "lucide-react";

type Props = {
  onBack: () => void;
};

export function PocPage({ onBack }: Props) {
  return (
    <main className="pocShell">
      <header className="pocTopBar">
        <div className="brand">
          <span className="brandMark pocBrandMark" aria-hidden="true">
            <FlaskConical size={20} />
          </span>
          <div className="brandText">
            <h1>
              POC
              <span className="categoryChip">LAB</span>
            </h1>
            <p>아이디어를 빠르게 붙이고 검증하는 실험 공간입니다.</p>
          </div>
        </div>
        <button className="button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          워크스페이스로
        </button>
      </header>

      <section className="pocPanel">
        <div className="pocHero">
          <span className="pocEyebrow">PROOF OF CONCEPT</span>
          <h2>첫 번째 실험을 시작해 보세요.</h2>
          <p>운영 화면에 영향을 주지 않고 새로운 흐름과 기능을 시험할 수 있습니다.</p>
        </div>

        <button className="pocStarterCard" type="button">
          <span className="pocStarterIcon" aria-hidden="true">
            <Plus size={22} />
          </span>
          <span>
            <strong>새 실험 영역</strong>
            <small>여기에 POC 기능을 연결하세요.</small>
          </span>
        </button>
      </section>
    </main>
  );
}
