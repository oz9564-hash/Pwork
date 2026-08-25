from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Flowable
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output" / "pdf" / "pdf-text-mapper-project-structure.pdf"
FONT = ROOT / "public" / "fonts" / "malgun.ttf"
OUT.parent.mkdir(parents=True, exist_ok=True)

pdfmetrics.registerFont(TTFont("KR", str(FONT)))

NAVY = colors.HexColor("#16283F")
BLUE = colors.HexColor("#2563EB")
SKY = colors.HexColor("#EAF2FF")
MINT = colors.HexColor("#E7F7F1")
GREEN = colors.HexColor("#15866B")
INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#D9E2EF")
PALE = colors.HexColor("#F6F8FB")
WHITE = colors.white

styles = getSampleStyleSheet()
title = ParagraphStyle("TitleKR", fontName="KR", fontSize=27, leading=36, textColor=WHITE, alignment=TA_LEFT)
subtitle = ParagraphStyle("SubKR", fontName="KR", fontSize=11, leading=18, textColor=colors.HexColor("#DCE8F8"))
h1 = ParagraphStyle("H1KR", fontName="KR", fontSize=19, leading=26, textColor=NAVY, spaceAfter=8)
h2 = ParagraphStyle("H2KR", fontName="KR", fontSize=12.5, leading=19, textColor=BLUE, spaceBefore=8, spaceAfter=5)
body = ParagraphStyle("BodyKR", fontName="KR", fontSize=9.3, leading=15, textColor=INK, spaceAfter=5)
small = ParagraphStyle("SmallKR", fontName="KR", fontSize=8, leading=12.5, textColor=MUTED)
box = ParagraphStyle("BoxKR", fontName="KR", fontSize=9, leading=14, textColor=INK)
box_center = ParagraphStyle("BoxCenterKR", parent=box, alignment=TA_CENTER)
white_small = ParagraphStyle("WhiteSmall", fontName="KR", fontSize=8.5, leading=13, textColor=WHITE)
white_head = ParagraphStyle("WhiteHead", fontName="KR", fontSize=12.5, leading=19, textColor=WHITE, spaceAfter=0)


class SectionTag(Flowable):
    def __init__(self, text):
        super().__init__(); self.text = text; self.width = 34*mm; self.height = 7*mm
    def draw(self):
        self.canv.setFillColor(BLUE); self.canv.roundRect(0, 0, self.width, self.height, 3*mm, fill=1, stroke=0)
        self.canv.setFillColor(WHITE); self.canv.setFont("KR", 7.5)
        self.canv.drawCentredString(self.width/2, 2.2*mm, self.text)


def p(text, style=body):
    return Paragraph(text, style)


def card(text, bg=PALE, border=LINE, width=160*mm, align="left"):
    st = box_center if align == "center" else box
    t = Table([[p(text, st)]], colWidths=[width], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), bg), ("BOX", (0,0), (-1,-1), 0.7, border),
        ("LEFTPADDING", (0,0), (-1,-1), 9), ("RIGHTPADDING", (0,0), (-1,-1), 9),
        ("TOPPADDING", (0,0), (-1,-1), 8), ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    return t


def arrow():
    return p("↓", ParagraphStyle("Arrow", fontName="KR", fontSize=13, leading=15, alignment=TA_CENTER, textColor=BLUE))


def page_header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE); canvas.setLineWidth(0.5)
    canvas.line(22*mm, 15*mm, 188*mm, 15*mm)
    canvas.setFont("KR", 7.5); canvas.setFillColor(MUTED)
    canvas.drawString(22*mm, 9.5*mm, "PDF 텍스트 매퍼 - 프로젝트 구조 안내")
    canvas.drawRightString(188*mm, 9.5*mm, str(doc.page))
    canvas.restoreState()


doc = BaseDocTemplate(str(OUT), pagesize=A4, leftMargin=22*mm, rightMargin=22*mm,
                      topMargin=20*mm, bottomMargin=21*mm, title="PDF 텍스트 매퍼 프로젝트 구조")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="normal", frames=frame, onPage=page_header_footer)])

story = []

# Cover
cover = Table([[p("PDF 텍스트 매퍼", title)], [p("프로젝트 구조와 데이터 흐름 안내서", subtitle)],
               [Spacer(1, 15*mm)],
               [p("화면에서 입력한 값이 어디에 저장되고,<br/>원본 PDF가 어떻게 완성된 PDF로 만들어지는지<br/>한 흐름으로 이해하기 위한 문서", white_small)]],
              colWidths=[166*mm], rowHeights=[32*mm, 15*mm, 26*mm, 50*mm])
cover.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),NAVY), ("LEFTPADDING",(0,0),(-1,-1),15*mm),
                           ("RIGHTPADDING",(0,0),(-1,-1),15*mm), ("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
story += [Spacer(1, 24*mm), cover, Spacer(1, 14*mm)]
summary = Table([[p("핵심 요약", h2), p("React 화면에서 Firebase를 직접 사용하며, PDF 생성은 서버가 아니라 사용자의 브라우저에서 처리됩니다.", body)]], colWidths=[32*mm, 128*mm])
summary.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),SKY), ("BOX",(0,0),(-1,-1),0.8,colors.HexColor("#B9D1FB")),
                             ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("LEFTPADDING",(0,0),(-1,-1),10),
                             ("RIGHTPADDING",(0,0),(-1,-1),10), ("TOPPADDING",(0,0),(-1,-1),10), ("BOTTOMPADDING",(0,0),(-1,-1),10)]))
story += [summary, Spacer(1, 18*mm), p("작성 기준: 2026-07-14 현재 코드", small), PageBreak()]

# 1
story += [SectionTag("01 전체 그림"), Spacer(1,5*mm), p("프로젝트를 한 문장으로 보면", h1),
          card("하나의 <b>워크스페이스</b> 안에서 표 데이터를 입력하고, 원본 PDF에 출력 위치를 지정한 뒤, 각 데이터 열마다 완성된 PDF를 브라우저에서 생성하는 앱입니다.", SKY, colors.HexColor("#B9D1FB")), Spacer(1,8*mm)]

tech = [[p("화면", white_head), p("상태와 로직", white_head), p("저장과 파일", white_head), p("PDF 처리", white_head)],
        [p("React 19<br/>TypeScript<br/>Vite", box_center), p("App<br/>도메인 훅<br/>선택 훅", box_center), p("Firebase Auth<br/>Firestore<br/>Storage", box_center), p("pdf-lib<br/>pdf.js<br/>fontkit", box_center)]]
t = Table(tech, colWidths=[40*mm]*4, rowHeights=[12*mm,35*mm])
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY), ("TEXTCOLOR",(0,0),(-1,0),WHITE),
                       ("BACKGROUND",(0,1),(-1,1),PALE), ("GRID",(0,0),(-1,-1),0.6,LINE),
                       ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("ALIGN",(0,0),(-1,-1),"CENTER")]))
story += [t, Spacer(1,10*mm), p("전체 연결 관계", h2)]
flow = Table([[p("사용자", box_center), p("→", box_center), p("App.tsx<br/><font color='#64748B'>전체 조정자</font>", box_center), p("→", box_center), p("도메인 훅<br/><font color='#64748B'>표 / PDF / 선택</font>", box_center), p("→", box_center), p("repository<br/><font color='#64748B'>Firebase 접근</font>", box_center)]], colWidths=[25*mm,8*mm,35*mm,8*mm,42*mm,8*mm,34*mm])
flow.setStyle(TableStyle([("BACKGROUND",(0,0),(0,0),MINT), ("BACKGROUND",(2,0),(2,0),SKY), ("BACKGROUND",(4,0),(4,0),PALE), ("BACKGROUND",(6,0),(6,0),colors.HexColor("#FFF5E8")),
                          ("BOX",(0,0),(0,0),0.7,LINE), ("BOX",(2,0),(2,0),0.7,LINE), ("BOX",(4,0),(4,0),0.7,LINE), ("BOX",(6,0),(6,0),0.7,LINE),
                          ("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
story += [flow, Spacer(1,8*mm), card("별도의 백엔드 애플리케이션 서버는 없습니다. 브라우저가 Firebase에 직접 접속하고, PDF 연산도 브라우저에서 수행합니다.", MINT, colors.HexColor("#B7E4D4")), PageBreak()]

# 2
story += [SectionTag("02 화면 진입"), Spacer(1,5*mm), p("사용자가 작업 화면에 들어오기까지", h1)]
for idx, txt in enumerate(["앱 실행 및 Google 로그인 확인", "사용자 프로필에서 category 확인", "같은 category의 워크스페이스 목록 로딩", "워크스페이스 선택", "표 데이터와 PDF 데이터를 동시에 로딩", "실제 작업 화면 표시"]):
    story.append(card(f"<b>{idx+1}</b>&nbsp;&nbsp;{txt}", SKY if idx in (0,3,5) else PALE, LINE, 150*mm))
    if idx < 5: story.append(arrow())
story += [Spacer(1,7*mm), p("여기서 가장 중요한 단위", h2),
          card("현재 시스템의 실제 작업 단위는 <b>워크스페이스</b>입니다. 표, 이미지, PDF 원본, 출력 영역, 미세조정 설정이 모두 선택한 워크스페이스 경로 아래에서 함께 관리됩니다.", MINT, colors.HexColor("#B7E4D4")), PageBreak()]

# 3
story += [SectionTag("03 저장 구조"), Spacer(1,5*mm), p("무엇이 어디에 저장되는가", h1),
          p("작은 데이터와 큰 파일을 서로 다른 저장소에 나눠 보관합니다.", body)]
store = [[p("Cloud Firestore", h2), p("Firebase Storage", h2)],
         [p("워크스페이스 정보<br/>행과 열<br/>PDF 파일 메타데이터<br/>PDF 출력 영역<br/>열별 미세조정<br/>폰트 메타데이터", box),
          p("원본 PDF 파일<br/>셀 이미지 파일<br/>업로드한 폰트 파일", box)]]
t = Table(store, colWidths=[80*mm,80*mm], rowHeights=[14*mm,58*mm])
t.setStyle(TableStyle([("BACKGROUND",(0,0),(0,0),SKY), ("BACKGROUND",(1,0),(1,0),MINT),
                       ("BACKGROUND",(0,1),(-1,1),PALE), ("GRID",(0,0),(-1,-1),0.7,LINE),
                       ("VALIGN",(0,0),(-1,-1),"TOP"), ("LEFTPADDING",(0,0),(-1,-1),12), ("TOPPADDING",(0,0),(-1,-1),10)]))
story += [t, Spacer(1,8*mm), p("워크스페이스 내부 데이터", h2)]
tree = "categories / {category}<br/>&nbsp;&nbsp;└ workspaces / {workspaceId}<br/>&nbsp;&nbsp;&nbsp;&nbsp;├ fieldRows - 항목 행<br/>&nbsp;&nbsp;&nbsp;&nbsp;├ valueColumns - 값 열과 셀 데이터<br/>&nbsp;&nbsp;&nbsp;&nbsp;├ pdfSlotRows - PDF 매핑 행<br/>&nbsp;&nbsp;&nbsp;&nbsp;├ pdfAreas - 공통 출력 영역<br/>&nbsp;&nbsp;&nbsp;&nbsp;├ columnPdfAdjusts - 열별 미세조정<br/>&nbsp;&nbsp;&nbsp;&nbsp;└ settings - 폰트 설정"
story += [card(tree, colors.HexColor("#F3F5F8"), LINE), Spacer(1,8*mm), p("현재 원본 PDF의 위치", h2),
          card("Storage: categories / {category} / workspaces / {workspaceId} / pdfs / {pdfRowId}<br/><br/>현재 원본 PDF는 독립 보관함의 파일이 아니라 <b>PDF 매핑 행에 종속</b>되어 있습니다.", colors.HexColor("#FFF5E8"), colors.HexColor("#F2CF9C")), PageBreak()]

# 4
story += [SectionTag("04 표 구조"), Spacer(1,5*mm), p("표의 행과 열은 어떤 의미인가", h1),
          card("행은 <b>입력 항목의 종류</b>, 열은 <b>실제 출력 대상 한 건</b>입니다.", SKY, colors.HexColor("#B9D1FB")), Spacer(1,8*mm)]
grid = [[p("항목", white_head), p("고객 A", white_head), p("고객 B", white_head)],
        [p("성명", box_center), p("홍길동", box_center), p("김영희", box_center)],
        [p("주소", box_center), p("서울특별시 ...", box_center), p("부산광역시 ...", box_center)],
        [p("계약일", box_center), p("2026-07-14", box_center), p("2026-07-15", box_center)]]
t = Table(grid, colWidths=[45*mm,57.5*mm,57.5*mm], rowHeights=[13*mm]*4)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY), ("TEXTCOLOR",(0,0),(-1,0),WHITE),
                       ("BACKGROUND",(0,1),(0,-1),PALE), ("GRID",(0,0),(-1,-1),0.7,LINE),
                       ("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
story += [t, Spacer(1,8*mm), p("PDF와 연결될 때", h2)]
pair = Table([[card("고객 A 열<br/>성명 + 주소 + 계약일", SKY, LINE, 48*mm, "center"), p("+", box_center), card("계약서 원본<br/>출력 위치 설정", PALE, LINE, 48*mm, "center"), p("=", box_center), card("고객 A<br/>완성 계약서.pdf", MINT, LINE, 48*mm, "center")]], colWidths=[48*mm,8*mm,48*mm,8*mm,48*mm])
pair.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
story += [pair, Spacer(1,10*mm), p("표 영역의 주요 기능", h2),
          card("행과 열 추가 / 이름 변경 / 열 복제 / 다중 셀 복사·붙여넣기 / 셀 삭제와 실행 취소 / 이미지 업로드 / 자동 저장", PALE, LINE), PageBreak()]

# 5
story += [SectionTag("05 PDF 연결"), Spacer(1,5*mm), p("원본 PDF와 출력 설정의 관계", h1)]
parts = [[p("1. PDF 매핑 행", h2), p("2. 기준 영역", h2), p("3. 열별 미세조정", h2)],
         [p("어떤 원본 PDF를 사용할지 결정합니다.<br/><br/>현재 파일은 매핑 행과 1:1로 연결됩니다.", box),
          p("몇 페이지의 어느 위치에 어떤 표 항목을 출력할지 정합니다.<br/><br/>모든 열이 공유합니다.", box),
          p("특정 열에만 위치, 크기, 글자 설정을 덧씌웁니다.<br/><br/>필요한 경우에만 존재합니다.", box)]]
t = Table(parts, colWidths=[53.3*mm]*3, rowHeights=[15*mm,63*mm])
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),SKY), ("BACKGROUND",(0,1),(-1,1),PALE),
                       ("GRID",(0,0),(-1,-1),0.7,LINE), ("VALIGN",(0,0),(-1,-1),"TOP"),
                       ("LEFTPADDING",(0,0),(-1,-1),10), ("RIGHTPADDING",(0,0),(-1,-1),10), ("TOPPADDING",(0,0),(-1,-1),10)]))
story += [t, Spacer(1,9*mm)]
for txt in ["원본 PDF", "공통 기준 영역", "현재 열의 값과 이미지", "필요한 경우 열별 미세조정", "최종 PDF"]:
    story.append(card(txt, MINT if txt == "최종 PDF" else PALE, LINE, 125*mm, "center"))
    if txt != "최종 PDF": story.append(arrow())
story += [PageBreak()]

# 6
story += [SectionTag("06 PDF 생성"), Spacer(1,5*mm), p("다운로드 버튼을 누르면 내부에서 일어나는 일", h1)]
steps = [
    ("1", "Storage에서 원본 PDF를 Blob으로 가져옵니다."),
    ("2", "pdf-lib가 원본을 PDFDocument로 엽니다."),
    ("3", "한글 출력을 위한 폰트를 PDF에 포함합니다."),
    ("4", "각 기준 영역에 현재 열의 텍스트 또는 이미지를 그립니다."),
    ("5", "기준 영역과 열별 미세조정 값을 합쳐 최종 위치를 계산합니다."),
    ("6", "완성된 PDF를 Uint8Array 바이트로 생성합니다."),
    ("7", "브라우저에서 파일을 다운로드하고 임시 URL을 해제합니다."),
]
rows=[]
for n, txt in steps:
    rows.append([p(n, ParagraphStyle("N", fontName="KR", fontSize=12, leading=16, textColor=WHITE, alignment=TA_CENTER)), p(txt, box)])
t=Table(rows, colWidths=[13*mm,147*mm], rowHeights=[18*mm]*len(rows))
t.setStyle(TableStyle([("BACKGROUND",(0,0),(0,-1),BLUE), ("BACKGROUND",(1,0),(1,-1),PALE),
                       ("GRID",(0,0),(-1,-1),0.6,LINE), ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
                       ("LEFTPADDING",(1,0),(1,-1),11)]))
story += [t, Spacer(1,8*mm), card("결과 PDF는 Firebase Storage에 저장되지 않습니다. 현재도 브라우저 메모리에서 생성한 뒤 바로 다운로드하는 구조입니다.", MINT, colors.HexColor("#B7E4D4")), Spacer(1,8*mm),
          p("관련 모듈", h2), card("pdfExport.ts - 전체 PDF 생성과 병합<br/>geometry.ts - 화면 좌표를 PDF 좌표로 변환<br/>textRenderer.ts / imageRenderer.ts - 텍스트와 이미지 출력<br/>fonts.ts - 한글 폰트 처리", PALE, LINE), PageBreak()]

# 7
story += [SectionTag("07 코드 지도"), Spacer(1,5*mm), p("주요 파일을 역할별로 찾기", h1)]
file_rows = [[p("파일", white_head), p("역할", white_head)],
             [p("src/App.tsx", box), p("로그인, 워크스페이스, 표, PDF, 모달을 연결하는 전체 조정자", box)],
             [p("src/hooks/useSheetData.ts", box), p("행, 열, 셀 값, 이미지와 표 저장 로직", box)],
             [p("src/hooks/usePdfData.ts", box), p("PDF 행, 영역, 미세조정, 출력과 다운로드", box)],
             [p("src/hooks/useSheetSelection.ts", box), p("셀 범위 선택, 복사, 선택 상태", box)],
             [p("src/services/storage.ts", box), p("Firestore와 Storage를 모두 감싸는 repository", box)],
             [p("src/services/pdfExport.ts", box), p("PDF 렌더링, 병합, 다운로드", box)],
             [p("src/components/PdfSetupModal.tsx", box), p("PDF 출력 영역 편집과 결과 미리보기", box)],
             [p("src/types.ts", box), p("프로젝트 핵심 데이터 타입", box)]]
t=Table(file_rows, colWidths=[60*mm,100*mm], rowHeights=[13*mm]+[19*mm]*8)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY), ("TEXTCOLOR",(0,0),(-1,0),WHITE),
                       ("BACKGROUND",(0,1),(-1,-1),PALE), ("ROWBACKGROUNDS",(0,1),(-1,-1),[WHITE,PALE]),
                       ("GRID",(0,0),(-1,-1),0.6,LINE), ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
                       ("LEFTPADDING",(0,0),(-1,-1),9)]))
story += [t, PageBreak()]

# 8
story += [SectionTag("08 새 기능 위치"), Spacer(1,5*mm), p("PDF 보관함과 분리·병합 기능은 어디에 들어갈까", h1),
          p("현재의 워크스페이스 단위는 유지하고, 그 안에 두 개의 독립 영역을 추가하는 방향이 자연스럽습니다.", body)]
new = Table([[p("현재 워크스페이스", white_head)],
             [p("표 데이터 및 PDF 매핑", box_center)],
             [p("+", box_center)],
             [p("PDF 보관함<br/><font color='#64748B'>원본 PDF를 장기 보관하고 목록화</font>", box_center)],
             [p("+", box_center)],
             [p("PDF 구성 도구<br/><font color='#64748B'>선택, 페이지 범위, 순서를 메모리에서 관리</font>", box_center)],
             [p("↓", box_center)],
             [p("결과 PDF 다운로드<br/><font color='#64748B'>결과는 서버에 저장하지 않음</font>", box_center)]], colWidths=[140*mm],
            rowHeights=[14*mm,19*mm,8*mm,27*mm,8*mm,27*mm,8*mm,27*mm])
new.setStyle(TableStyle([("BACKGROUND",(0,0),(0,0),NAVY), ("TEXTCOLOR",(0,0),(0,0),WHITE),
                         ("BACKGROUND",(0,1),(0,1),PALE), ("BACKGROUND",(0,3),(0,3),SKY),
                         ("BACKGROUND",(0,5),(0,5),colors.HexColor("#FFF5E8")), ("BACKGROUND",(0,7),(0,7),MINT),
                         ("BOX",(0,0),(0,1),0.7,LINE), ("BOX",(0,3),(0,3),0.7,LINE),
                         ("BOX",(0,5),(0,5),0.7,LINE), ("BOX",(0,7),(0,7),0.7,LINE),
                         ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("ALIGN",(0,0),(-1,-1),"CENTER")]))
story += [new, Spacer(1,8*mm), p("기존 코드 중 재사용 가능한 부분", h2),
          card("워크스페이스 경로 구조 / Firebase Storage 업로드·다운로드 / pdf-lib 병합 함수 / 브라우저 다운로드 / 진행 상태와 알림 UI", MINT, colors.HexColor("#B7E4D4")), PageBreak()]

# 9
story += [SectionTag("09 핵심 정리"), Spacer(1,5*mm), p("이 프로젝트를 이해할 때 기억할 6가지", h1)]
items = [
    ("1", "워크스페이스가 모든 작업 데이터의 기본 단위입니다."),
    ("2", "App.tsx가 화면과 여러 도메인 훅을 연결합니다."),
    ("3", "Firestore에는 구조화된 데이터, Storage에는 실제 파일이 저장됩니다."),
    ("4", "표의 한 열이 완성 PDF 한 세트의 데이터가 됩니다."),
    ("5", "PDF 출력은 공통 기준 영역과 선택적인 열별 미세조정으로 구성됩니다."),
    ("6", "PDF 결과 생성과 병합은 브라우저 메모리에서 처리됩니다."),
]
for n, txt in items:
    row=Table([[p(n, ParagraphStyle("BigN", fontName="KR", fontSize=16, leading=18, textColor=BLUE, alignment=TA_CENTER)), p(txt, box)]], colWidths=[18*mm,142*mm], rowHeights=[23*mm])
    row.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PALE), ("BOX",(0,0),(-1,-1),0.6,LINE),
                             ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("LEFTPADDING",(1,0),(1,0),10)]))
    story += [row, Spacer(1,3*mm)]
story += [Spacer(1,7*mm), card("다음 작업을 시작한다면 가장 작은 첫 단위는, 기존 PDF 매핑을 건드리지 않고 <b>워크스페이스 안의 PDF 보관함 데이터 모델과 목록 읽기</b>부터 정의하는 것입니다.", SKY, colors.HexColor("#B9D1FB"))]

doc.build(story)
print(OUT)
