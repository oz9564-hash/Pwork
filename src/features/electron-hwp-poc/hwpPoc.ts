import * as CFB from "cfb";
import JSZip from "jszip";
import { inflateRaw } from "pako";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document as XmlDocument, Element as XmlElement } from "@xmldom/xmldom";

const PARA_HEADER_TAG = 66;
const PARA_TEXT_TAG = 67;
const PARA_CHAR_SHAPE_TAG = 68;
const HWPX_PARAGRAPH_NS = "http://www.hancom.co.kr/hwpml/2011/paragraph";

type HwpRecord = {
  tag: number;
  level: number;
  payload: Uint8Array;
  removed?: boolean;
};

type HwpParagraph = {
  index: number;
  headerRecordIndex: number;
  textRecordIndexes: number[];
  charShapeRecordIndexes: number[];
  text: string;
};

type ParsedHwp = {
  cfb: CFB.CFB$Container;
  records: HwpRecord[];
  paragraphs: HwpParagraph[];
  compressed: boolean;
};

export type PocSession = {
  round: string;
  participant: string;
  department: string;
  date: string;
  interview: string;
  inquiry: string;
  action: string;
  other: string;
};

export type PocHwpData = {
  companyName: string;
  programName: string;
  period: string;
  mentorName: string;
  mentorDepartment: string;
  mentorTitle: string;
  mentorPhone: string;
  mentorEmail: string;
  sessions: PocSession[];
};

type ParagraphGroup = {
  indices: number[];
};

type SessionMapping = {
  participantIndex: number;
  departmentIndex: number;
  dateIndex: number;
  interview: ParagraphGroup;
  inquiry: ParagraphGroup;
  action: ParagraphGroup;
  other: ParagraphGroup;
};

type PatternMapping = {
  fields: Record<Exclude<keyof PocHwpData, "sessions">, number>;
  sessions: SessionMapping[];
};

export type PocHwpAnalysis = {
  blankParagraphCount: number;
  patternParagraphCount: number;
  data: PocHwpData;
};

function asUint8Array(value: CFB.CFB$Blob) {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function parseRecords(data: Uint8Array) {
  const result: HwpRecord[] = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const header = readUint32(data, offset);
    offset += 4;
    const tag = header & 0x3ff;
    const level = (header >>> 10) & 0x3ff;
    let size = header >>> 20;
    if (size === 0xfff) {
      if (offset + 4 > data.length) throw new Error("손상된 HWP 레코드입니다.");
      size = readUint32(data, offset);
      offset += 4;
    }
    if (offset + size > data.length) throw new Error("HWP 본문 레코드 크기가 올바르지 않습니다.");
    result.push({ tag, level, payload: data.slice(offset, offset + size) });
    offset += size;
  }
  return result;
}

function decodeParagraphText(payload: Uint8Array) {
  const units = new Uint16Array(payload.length >> 1);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (let index = 0; index < units.length; index += 1) units[index] = view.getUint16(index * 2, true);

  const chars: string[] = [];
  let index = 0;
  while (index < units.length) {
    const value = units[index];
    if (value === 10 || value === 13) {
      chars.push("\n");
      index += 1;
    } else if (value === 0) {
      index += 1;
    } else if (value < 32) {
      index += 8;
    } else {
      chars.push(String.fromCharCode(value));
      index += 1;
    }
  }
  return chars.join("").trim();
}

function collectParagraphs(records: HwpRecord[]) {
  const paragraphs: HwpParagraph[] = [];
  let current: HwpParagraph | undefined;
  records.forEach((record, recordIndex) => {
    if (record.tag === PARA_HEADER_TAG) {
      current = {
        index: paragraphs.length,
        headerRecordIndex: recordIndex,
        textRecordIndexes: [],
        charShapeRecordIndexes: [],
        text: "",
      };
      paragraphs.push(current);
    } else if (current && record.tag === PARA_TEXT_TAG) {
      current.textRecordIndexes.push(recordIndex);
      current.text += decodeParagraphText(record.payload);
    } else if (current && record.tag === PARA_CHAR_SHAPE_TAG) {
      current.charShapeRecordIndexes.push(recordIndex);
    }
  });
  return paragraphs;
}

function parseHwp(buffer: ArrayBuffer): ParsedHwp {
  const cfb = CFB.read(new Uint8Array(buffer), { type: "array" });
  const headerEntry = CFB.find(cfb, "FileHeader");
  const sectionEntry = CFB.find(cfb, "/BodyText/Section0");
  if (!headerEntry || !sectionEntry) throw new Error("HWP 5.x 문서가 아니거나 본문을 찾을 수 없습니다.");

  const header = asUint8Array(headerEntry.content);
  const compressed = Boolean(readUint32(header, 36) & 1);
  const storedSection = asUint8Array(sectionEntry.content);
  const section = compressed ? inflateRaw(storedSection) : storedSection;
  const records = parseRecords(section);
  return { cfb, records, paragraphs: collectParagraphs(records), compressed };
}

function findValueIndex(paragraphs: HwpParagraph[], label: string, start = 0) {
  const labelIndex = paragraphs.findIndex((paragraph, index) => index >= start && paragraph.text === label);
  if (labelIndex < 0 || !paragraphs[labelIndex + 1]) throw new Error(`'${label}' 다음 값을 찾을 수 없습니다.`);
  return labelIndex + 1;
}

function range(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
}

function buildPatternMapping(paragraphs: HwpParagraph[]): PatternMapping {
  const participantHeaderIndex = paragraphs.findIndex((paragraph) => paragraph.text === "■ 참여청년 명단");
  if (participantHeaderIndex < 0) throw new Error("참여청년 명단 영역을 찾을 수 없습니다.");

  const fields: PatternMapping["fields"] = {
    companyName: findValueIndex(paragraphs, "참여기업명"),
    programName: findValueIndex(paragraphs, "프로그램명"),
    period: findValueIndex(paragraphs, "일경험 기간"),
    mentorName: findValueIndex(paragraphs, "성명"),
    mentorDepartment: findValueIndex(paragraphs, "부서"),
    mentorTitle: findValueIndex(paragraphs, "직급"),
    mentorPhone: findValueIndex(paragraphs, "전화번호"),
    mentorEmail: findValueIndex(paragraphs, "이메일"),
  };

  const roundStarts: number[] = [];
  for (let round = 1; round <= 8; round += 1) {
    const index = paragraphs.findIndex(
      (paragraph, paragraphIndex) => paragraphIndex > participantHeaderIndex && paragraph.text === String(round),
    );
    if (index < 0) throw new Error(`${round}회차 면담 영역을 찾을 수 없습니다.`);
    roundStarts.push(index);
  }

  const noteIndex = paragraphs.findIndex((paragraph) => paragraph.text.startsWith("※ 참여기업 멘토는"));
  const sessions = roundStarts.map((start, sessionIndex) => {
    const end = roundStarts[sessionIndex + 1] ?? (noteIndex > start ? noteIndex : paragraphs.length);
    const inquiryHeading = paragraphs.findIndex(
      (paragraph, index) => index > start + 3 && index < end && ["문의 및 논의", "건의 및 문의"].includes(paragraph.text),
    );
    const actionHeading = paragraphs.findIndex(
      (paragraph, index) => index > inquiryHeading && index < end && paragraph.text === "조치사항",
    );
    const otherHeading = paragraphs.findIndex(
      (paragraph, index) => index > actionHeading && index < end && paragraph.text === "기타",
    );
    if (inquiryHeading < 0 || actionHeading < 0 || otherHeading < 0) {
      throw new Error(`${sessionIndex + 1}회차의 면담 구분을 찾을 수 없습니다.`);
    }
    return {
      participantIndex: start + 1,
      departmentIndex: start + 2,
      dateIndex: start + 3,
      interview: { indices: range(start + 5, inquiryHeading) },
      inquiry: { indices: range(inquiryHeading + 1, actionHeading) },
      action: { indices: range(actionHeading + 1, otherHeading) },
      other: { indices: range(otherHeading + 1, end) },
    };
  });

  return { fields, sessions };
}

function groupText(paragraphs: HwpParagraph[], group: ParagraphGroup) {
  return group.indices
    .map((index) => paragraphs[index]?.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function extractData(paragraphs: HwpParagraph[], mapping: PatternMapping): PocHwpData {
  const value = (index: number) => paragraphs[index]?.text ?? "";
  return {
    companyName: value(mapping.fields.companyName),
    programName: value(mapping.fields.programName),
    period: value(mapping.fields.period),
    mentorName: value(mapping.fields.mentorName),
    mentorDepartment: value(mapping.fields.mentorDepartment),
    mentorTitle: value(mapping.fields.mentorTitle),
    mentorPhone: value(mapping.fields.mentorPhone),
    mentorEmail: value(mapping.fields.mentorEmail),
    sessions: mapping.sessions.map((session, index) => ({
      round: String(index + 1),
      participant: value(session.participantIndex),
      department: value(session.departmentIndex),
      date: value(session.dateIndex),
      interview: groupText(paragraphs, session.interview),
      inquiry: groupText(paragraphs, session.inquiry),
      action: groupText(paragraphs, session.action),
      other: groupText(paragraphs, session.other),
    })),
  };
}

export async function analyzeHwpFiles(blankFile: File, patternFile: File): Promise<PocHwpAnalysis> {
  const [blank, pattern] = await Promise.all([blankFile.arrayBuffer(), patternFile.arrayBuffer()]);
  const blankZip = await JSZip.loadAsync(blank);
  const blankSection = blankZip.file("Contents/section0.xml");
  if (!blankSection) throw new Error("빈 원본 HWPX의 본문을 찾을 수 없습니다.");
  const blankXml = new DOMParser().parseFromString(await blankSection.async("string"), "application/xml");
  const blankParagraphs = Array.from(blankXml.getElementsByTagNameNS(HWPX_PARAGRAPH_NS, "p"));
  const blankTexts = blankParagraphs.map((paragraph) => paragraph.textContent?.trim() ?? "");
  const parsedPattern = parseHwp(pattern);
  const blankTitle = blankTexts.some((text) => text.includes("참여청년 멘토 면담일지"));
  const patternTitle = parsedPattern.paragraphs.some((paragraph) => paragraph.text.includes("참여청년 멘토 면담일지"));
  if (!blankTitle || !patternTitle) throw new Error("두 파일이 지원하는 면담일지 양식이 아닙니다.");
  if (blankTexts[9] !== "참여기업명" || blankTexts[32] !== "1" || blankTexts[74] !== "8") {
    throw new Error("빈 원본 HWPX의 표 구조가 예상한 면담일지 양식과 다릅니다.");
  }
  if (parsedPattern.paragraphs.length <= blankParagraphs.length) {
    throw new Error("오른쪽 파일에서 채워진 문서 패턴을 충분히 찾지 못했습니다.");
  }
  const mapping = buildPatternMapping(parsedPattern.paragraphs);
  return {
    blankParagraphCount: blankParagraphs.length,
    patternParagraphCount: parsedPattern.paragraphs.length,
    data: extractData(parsedPattern.paragraphs, mapping),
  };
}

function setParagraphText(document: XmlDocument, paragraph: XmlElement, value: string) {
  const run = paragraph.getElementsByTagNameNS(HWPX_PARAGRAPH_NS, "run")[0];
  if (!run) throw new Error("원본 HWPX의 문단 실행 정보를 찾을 수 없습니다.");
  let text = paragraph.getElementsByTagNameNS(HWPX_PARAGRAPH_NS, "t")[0];
  if (!text) {
    text = document.createElementNS(HWPX_PARAGRAPH_NS, "hp:t");
    run.appendChild(text);
  }
  while (text.firstChild) text.removeChild(text.firstChild);

  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, index) => {
    if (index > 0) text.appendChild(document.createElementNS(HWPX_PARAGRAPH_NS, "hp:lineBreak"));
    text.appendChild(document.createTextNode(line));
  });

  const lineSegments = Array.from(paragraph.getElementsByTagNameNS(HWPX_PARAGRAPH_NS, "linesegarray"));
  lineSegments.forEach((element) => element.parentNode?.removeChild(element));
}

function sessionContent(session: PocSession) {
  return [
    "면담내용",
    session.interview,
    "",
    "건의 및 문의",
    session.inquiry,
    "",
    "조치사항",
    session.action,
    "",
    "기타",
    session.other,
  ].join("\n");
}

export async function buildHwpx(template: ArrayBuffer | Uint8Array, data: PocHwpData) {
  const zip = await JSZip.loadAsync(template);
  const sectionFile = zip.file("Contents/section0.xml");
  if (!sectionFile) throw new Error("HWPX 템플릿 본문을 찾을 수 없습니다.");

  const document = new DOMParser().parseFromString(await sectionFile.async("string"), "application/xml");
  const paragraphs = Array.from(document.getElementsByTagNameNS(HWPX_PARAGRAPH_NS, "p"));
  if (paragraphs.length !== 82) throw new Error("원본 HWPX의 문단 구조가 변경되어 셀을 매핑할 수 없습니다.");

  const commonValues: Array<[number, string]> = [
    [10, data.companyName],
    [12, data.programName],
    [14, data.period],
    [17, data.mentorName],
    [19, data.mentorDepartment],
    [21, data.mentorTitle],
    [23, data.mentorPhone],
    [25, data.mentorEmail],
  ];
  commonValues.forEach(([index, value]) => setParagraphText(document, paragraphs[index], value));

  const participantIndexes = [33, 45, 50, 55, 60, 65, 70, 75];
  const departmentIndexes = [34, 46, 51, 56, 61, 66, 71, 76];
  const dateIndexes = [35, 47, 52, 57, 62, 67, 72, 77];
  const contentIndexes = [36, 48, 53, 58, 63, 68, 73, 78];
  data.sessions.forEach((session, index) => {
    setParagraphText(document, paragraphs[participantIndexes[index]], session.participant);
    setParagraphText(document, paragraphs[departmentIndexes[index]], session.department);
    setParagraphText(document, paragraphs[dateIndexes[index]], session.date);
    setParagraphText(document, paragraphs[contentIndexes[index]], sessionContent(session));
  });

  // 첫 회차에는 빈 양식 안내 문단이 여러 개 있으므로 통합한 내용 문단 외에는 제거한다.
  [37, 38, 39, 40, 41, 42, 43].forEach((index) => {
    paragraphs[index].parentNode?.removeChild(paragraphs[index]);
  });
  const sectionXml = new XMLSerializer().serializeToString(document);

  const previewText = [
    "청년 일경험 참여청년 멘토 면담일지",
    data.companyName,
    data.programName,
    data.period,
    data.mentorName,
    ...data.sessions.flatMap((session) => [
      `${session.round}회차 ${session.participant} ${session.department} ${session.date}`,
      session.interview,
      session.inquiry,
      session.action,
      session.other,
    ]),
  ].join("\n");

  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("Contents/section0.xml", sectionXml, { compression: "DEFLATE" });
  zip.file("Preview/PrvText.txt", previewText.slice(0, 1000), { compression: "DEFLATE" });
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/hwp+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function generateHwpx(templateFile: File, data: PocHwpData) {
  return buildHwpx(await templateFile.arrayBuffer(), data);
}
