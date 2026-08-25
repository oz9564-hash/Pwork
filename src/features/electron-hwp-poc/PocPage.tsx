import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Crosshair, Download, FilePlus2, FileText, FlaskConical, FolderOpen, Save } from "lucide-react";
import { analyzeHwpFiles } from "./hwpPoc";
import type { PocHwpData } from "./hwpPoc";

type Props = { onBack: () => void };

type CommonData = {
  companyName: string;
  programName: string;
  period: string;
  mentorName: string;
  mentorDepartment: string;
  mentorTitle: string;
  mentorPhone: string;
  mentorEmail: string;
  participantName: string;
  participantDepartment: string;
};

type RoundData = { round: number; date: string; content: string };

const commonFields: Array<{ key: keyof CommonData; label: string; hwpField: string; repeat?: number }> = [
  { key: "companyName", label: "참여기업명", hwpField: "참여기업명" },
  { key: "programName", label: "프로그램명", hwpField: "프로그램명" },
  { key: "period", label: "일경험 기간", hwpField: "일경험기간" },
  { key: "mentorName", label: "멘토 성명", hwpField: "멘토성명" },
  { key: "mentorDepartment", label: "멘토 부서", hwpField: "멘토부서" },
  { key: "mentorTitle", label: "멘토 직급", hwpField: "멘토직급" },
  { key: "mentorPhone", label: "멘토 전화번호", hwpField: "멘토전화번호" },
  { key: "mentorEmail", label: "멘토 이메일", hwpField: "멘토이메일" },
  { key: "participantName", label: "참여청년 성명", hwpField: "참여청년성명", repeat: 8 },
  { key: "participantDepartment", label: "참여청년 근무부서", hwpField: "참여청년근무부서", repeat: 8 },
];

const emptyCommon: CommonData = {
  companyName: "",
  programName: "",
  period: "",
  mentorName: "",
  mentorDepartment: "",
  mentorTitle: "",
  mentorPhone: "",
  mentorEmail: "",
  participantName: "",
  participantDepartment: "",
};

function emptyRounds(): RoundData[] {
  return Array.from({ length: 8 }, (_, index) => ({ round: index + 1, date: "", content: "" }));
}

function fullRoundContent(data: PocHwpData["sessions"][number]) {
  return [
    "면담내용",
    data.interview,
    "",
    "건의 및 문의",
    data.inquiry,
    "",
    "조치사항",
    data.action,
    "",
    "기타",
    data.other,
  ].join("\n").trim();
}

function extractedValues(data: PocHwpData) {
  const common: CommonData = {
    companyName: data.companyName,
    programName: data.programName,
    period: data.period,
    mentorName: data.mentorName,
    mentorDepartment: data.mentorDepartment,
    mentorTitle: data.mentorTitle,
    mentorPhone: data.mentorPhone,
    mentorEmail: data.mentorEmail,
    participantName: data.sessions[0]?.participant ?? "",
    participantDepartment: data.sessions[0]?.department ?? "",
  };
  const rounds = data.sessions.map((session, index) => ({
    round: index + 1,
    date: session.date,
    content: fullRoundContent(session),
  }));
  return { common, rounds };
}

function valuesForHwp(common: CommonData, rounds: RoundData[]) {
  const values: Record<string, string> = {};
  commonFields.forEach((field) => { values[field.hwpField] = common[field.key]; });
  rounds.forEach((round) => {
    values[`면담일_${round.round}`] = round.date;
    values[`면담기록_${round.round}`] = round.content;
  });
  return values;
}

export function PocPage({ onBack }: Props) {
  const desktop = window.hwpDesktop;
  const [available, setAvailable] = useState<boolean>();
  const [statusMessage, setStatusMessage] = useState("한글 자동화 상태 확인 중…");
  const [blankTemplatePath, setBlankTemplatePath] = useState("");
  const [templatePath, setTemplatePath] = useState("");
  const [common, setCommon] = useState<CommonData>(emptyCommon);
  const [rounds, setRounds] = useState<RoundData[]>(emptyRounds);
  const [selectedRound, setSelectedRound] = useState(1);
  const [mappingActive, setMappingActive] = useState(false);
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>({});
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewVersion, setPreviewVersion] = useState(0);
  const [outputPath, setOutputPath] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const activeRound = useMemo(() => rounds.find((round) => round.round === selectedRound) ?? rounds[0], [rounds, selectedRound]);

  useEffect(() => {
    if (!desktop) {
      setAvailable(false);
      setStatusMessage("Electron 앱에서만 한글 자동화를 사용할 수 있습니다.");
      return;
    }
    void desktop.getStatus().then((status) => {
      setAvailable(status.available);
      setStatusMessage(status.message);
    }).catch((caught) => {
      setAvailable(false);
      setStatusMessage(caught instanceof Error ? caught.message : "한글 자동화 상태를 확인하지 못했습니다.");
    });

    void desktop.getPocSample().then(async (sample) => {
      if (!sample) return;
      setBlankTemplatePath(sample.blankPath);
      try {
        const [blankBytes, patternBytes] = await Promise.all([desktop.readFile(sample.blankPath), desktop.readFile(sample.patternPath)]);
        const analysis = await analyzeHwpFiles(
          new File([blankBytes], "blank.hwp", { type: "application/x-hwp" }),
          new File([patternBytes], "pattern.hwp", { type: "application/x-hwp" }),
        );
        const extracted = extractedValues(analysis.data);
        setCommon(extracted.common);
        setRounds(extracted.rounds);
      } catch (caught) {
        console.error("[electron-poc] sample extraction failed", caught);
      }
    });
  }, [desktop]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function updateCommon(key: keyof CommonData, value: string) {
    setCommon((current) => ({ ...current, [key]: value }));
  }

  function updateRound(key: "date" | "content", value: string) {
    setRounds((current) => current.map((round) => round.round === selectedRound ? { ...round, [key]: value } : round));
  }

  async function chooseTemplate() {
    if (!desktop) return;
    const selected = await desktop.pickTemplate();
    if (selected) setBlankTemplatePath(selected);
  }

  async function startMapping() {
    if (!desktop || !blankTemplatePath) return;
    setBusy(true);
    setError(undefined);
    try {
      await desktop.startMapping(blankTemplatePath);
      setMappingActive(true);
      setMappingCounts({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "빈 한글 양식을 열지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function mapPosition(fieldName: string) {
    if (!desktop || !mappingActive) return;
    setError(undefined);
    try {
      await desktop.assignCurrentPosition(fieldName);
      setMappingCounts((current) => ({ ...current, [fieldName]: (current[fieldName] ?? 0) + 1 }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "현재 한글 위치를 매핑하지 못했습니다.");
    }
  }

  async function saveMapping() {
    if (!desktop || !mappingActive) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await desktop.saveMapping();
      if (!result) return;
      setTemplatePath(result.outputPath);
      await desktop.closeMapping();
      setMappingActive(false);
      setPreviewUrl(undefined);
      setOutputPath(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "매핑 양식을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createPreview() {
    if (!desktop || !templatePath) return;
    setBusy(true);
    setError(undefined);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setOutputPath(undefined);
    try {
      const result = await desktop.generate({
        templatePath,
        values: valuesForHwp(common, rounds),
        suggestedName: `${common.companyName || "참여기업"}_참여자(${common.participantName || "참여자"})_면담일지.hwp`,
        previewOnly: true,
      });
      if (!result) return;
      setOutputPath(result.outputPath);
      if (result.previewPath) {
        const bytes = await desktop.readFile(result.previewPath);
        setPreviewUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
        setPreviewVersion((current) => current + 1);
      } else {
        setError("HWP는 생성됐지만 PDF 미리보기를 만들지 못했습니다.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "미리보기를 생성하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pocShell electronPocShell">
      <header className="pocTopBar">
        <div className="brand">
          <span className="brandMark pocBrandMark" aria-hidden="true"><FlaskConical size={20} /></span>
          <div className="brandText">
            <h1>한글 자동작성 <span className="categoryChip">26 INPUT POC</span></h1>
            <p>공통정보 10개와 회차별 면담일·전체 기록을 빈 HWP 양식에 입력합니다.</p>
          </div>
        </div>
        <button className="button" type="button" onClick={onBack}><ArrowLeft size={16} />워크스페이스로</button>
      </header>

      <section className="electronPocToolbar">
        <div className={`electronStatus${available ? " isReady" : " isUnavailable"}`}>
          {available ? <CheckCircle2 size={16} /> : <FileText size={16} />}<span>{statusMessage}</span>
        </div>
        <button className="button" type="button" disabled={!desktop || busy} onClick={() => void chooseTemplate()}>
          <FolderOpen size={16} />빈 HWP 선택
        </button>
        <button className={`button${mappingActive ? " mappingActiveButton" : ""}`} type="button" disabled={!desktop || busy || !blankTemplatePath} onClick={() => void startMapping()}>
          <Crosshair size={16} />{mappingActive ? "매핑 다시 시작" : "빈 양식 매핑 시작"}
        </button>
        {mappingActive ? (
          <button className="button mappingSaveButton" type="button" disabled={busy || Object.keys(mappingCounts).length === 0} onClick={() => void saveMapping()}>
            <Save size={16} />매핑 양식 저장
          </button>
        ) : null}
        <span className="electronTemplatePath" title={templatePath}>{templatePath || "매핑 양식을 준비해 주세요."}</span>
        <button className="button primary" type="button" disabled={busy || !templatePath} onClick={() => void createPreview()}>
          <Download size={16} />{busy ? "처리 중…" : "미리보기 만들기"}
        </button>
      </section>

      {error ? <div className="pocError electronPocError">{error}</div> : null}

      <section className="electronPocBody structuredPocBody">
        <div className="electronSheetPanel structuredInputPanel">
          <div className="electronPanelHeading"><div><span>COMMON DATA</span><h2>공통정보 10개</h2></div></div>
          <div className="structuredInputScroll">
            <div className="commonInputGrid">
              {commonFields.map((field) => {
                const count = mappingCounts[field.hwpField] ?? 0;
                return (
                  <label key={field.key} className={field.key === "programName" ? "isWide" : undefined}>
                    <span>{field.label}{field.repeat ? ` · 문서 ${field.repeat}곳` : ""}</span>
                    <div className="mappedInputRow">
                      <input value={common[field.key]} onChange={(event) => updateCommon(field.key, event.target.value)} />
                      {mappingActive ? (
                        <button type="button" title="한글에서 대상 칸을 클릭한 뒤 매핑" onClick={() => void mapPosition(field.hwpField)}>
                          {count > 0 ? <CheckCircle2 size={14} /> : <Crosshair size={14} />}{count > 0 ? `${count}곳` : "매핑"}
                        </button>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="roundEditorHeading"><div><span>WEEKLY RECORDS</span><h2>회차별 입력</h2></div></div>
            <div className="roundEditorLayout">
              <nav className="roundList" aria-label="면담 회차">
                {rounds.map((round) => (
                  <button key={round.round} type="button" className={round.round === selectedRound ? "isSelected" : undefined} onClick={() => setSelectedRound(round.round)}>
                    <strong>{round.round}회차</strong><span>{round.date || "면담일 미입력"}</span>
                  </button>
                ))}
              </nav>
              <div className="roundForm">
                {(() => {
                  const dateFieldName = `면담일_${activeRound.round}`;
                  const recordFieldName = `면담기록_${activeRound.round}`;
                  const dateMappingCount = mappingCounts[dateFieldName] ?? 0;
                  const recordMappingCount = mappingCounts[recordFieldName] ?? 0;
                  return <>
                <label>
                  <span>{activeRound.round}회 면담일</span>
                  <div className="mappedInputRow">
                    <input value={activeRound.date} onChange={(event) => updateRound("date", event.target.value)} />
                    {mappingActive ? <button type="button" onClick={() => void mapPosition(dateFieldName)}>{dateMappingCount > 0 ? <CheckCircle2 size={14} /> : <Crosshair size={14} />}{dateMappingCount > 0 ? `${dateMappingCount}곳 매핑됨` : "매핑"}</button> : null}
                  </div>
                </label>
                <label className="roundContentField">
                  <span>{activeRound.round}회 전체 면담 기록</span>
                  <textarea value={activeRound.content} onChange={(event) => updateRound("content", event.target.value)} />
                  {mappingActive ? (
                    <button className="roundMapButton" type="button" onClick={() => void mapPosition(recordFieldName)}>
                      {recordMappingCount > 0 ? <CheckCircle2 size={14} /> : <Crosshair size={14} />}{recordMappingCount > 0 ? `${recordMappingCount}곳 매핑됨` : "한글의 전체 면담 기록 칸에 매핑"}
                    </button>
                  ) : null}
                </label>
                  </>;
                })()}
              </div>
            </div>
          </div>
        </div>

        <aside className="electronPreviewPanel">
          <div className="electronPanelHeading">
            <div><span>DOCUMENT PREVIEW</span><h2>한글 미리보기</h2></div>
            {outputPath && desktop ? <button className="button" type="button" onClick={() => void desktop.openPath(outputPath)}><FilePlus2 size={16} />HWP 열기</button> : null}
          </div>
          {previewUrl ? (
            <iframe key={previewVersion} className="electronPdfPreview" src={`${previewUrl}#view=FitH`} title="생성된 한글 문서 PDF 미리보기" />
          ) : (
            <div className="structuredPreviewEmpty"><FileText size={28} /><strong>미리보기 대기 중</strong><p>값을 입력하고 “미리보기 만들기”를 누르세요.</p></div>
          )}
        </aside>
      </section>
    </main>
  );
}
