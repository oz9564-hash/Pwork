# App.tsx 분리 리팩토링 명세 (AI 실행용)

> **상태: 3단계 모두 완료 (2026-06-11).** App.tsx 1,190줄 → 342줄.
> 1단계 `5b31185`, 2단계 `31c78c5`, 3단계 `d3610ec`. tsc/build 통과.
> 아래는 실행 당시의 명세 원본이며, 실제 구현이 일부 표현에서 더 단순해진 부분이 있다
> (예: 3단계 paste 선택 연동은 `onSelectRange` 콜백 대신 pasteSheetCells가 범위를 반환하고
> App의 handleSheetPaste가 selection.setRange를 호출하는 방식으로 순환 의존을 끊었다).

> 이 문서는 AI 에이전트가 읽고 그대로 실행하기 위한 명세다.
> 목표: **동작 변화 0**인 구조 리팩토링. 사용자가 보는 UI/동작/저장 결과가 1비트도 달라지면 안 된다.
> 각 단계는 독립 커밋이며, 단계 사이에 작업을 중단해도 앱은 항상 동작 상태여야 한다.

---

## 0. 프로젝트 컨텍스트

### 앱 개요
"PDF 텍스트 매퍼" — 엑셀형 그리드에 항목(행)×값(열)을 입력하고, PDF 위에 영역(스탬프)을 잡아
각 열의 값으로 채운 PDF를 생성하는 React(Vite+TS) + Firebase(Firestore/Storage) 앱.

### 파일 지도 (리팩토링 전 기준)
```
src/
  App.tsx                      # ~1,190줄. 이 문서의 분리 대상.
  types.ts                     # 도메인 타입 (FieldRow, ValueColumn, PdfSlotRow, PdfArea, ColumnPdfAdjust, FontAsset...)
  components/
    CellImageControl.tsx       # 셀 이미지 업로드/미리보기/삭제 버튼 (변경 금지)
    PdfSetupModal.tsx          # 기준 영역 편집 + 열별 미세조정 모달 (변경 금지)
  hooks/
    useSheetSelection.ts       # [1단계 산출물] 시트 범위 선택/복사 훅
  lib/
    debounceSave.ts            # createDebouncedSaver: schedule/flush/cancel/bypass/flushAll
    ids.ts, imageOptimize.ts
  services/
    storage.ts                 # repository: Firestore/Storage 영속화 전부 (변경 금지)
    firebase.ts                # SKIP_LOGIN, watchAuth, signIn/Out (변경 금지)
    pdfExport.ts, pdf/*        # PDF 생성 (변경 금지)
```

### 절대 침범 금지 불변식 (위반 = 데이터 유실 버그)

1. **디바운스 bypass 규칙**: 텍스트 편집(셀 값/항목명/열 이름/PDF행 이름)은 `saver.schedule(key, value)`로
   디바운스 저장한다. **디바운스를 우회해 문서 전체를 즉시 쓰는 모든 경로는 반드시
   `saver.bypass(keys, action)`로 감싼다** (bypass가 해당 key의 예약을 먼저 취소해 stale write 차단).
   리팩토링으로 코드를 옮길 때 bypass 래핑을 절대 벗기지 말 것.
2. **deleteRow 순서**: `await columnSaver.flushAll()` → `rowSaver.bypass(rowId, () => repository.deleteRow(rowId))`.
   repository.deleteRow가 각 열 문서에서 이 행의 값을 제거하므로, 열의 셀 편집 예약을 **먼저 flush(반영)**
   해야 한다 (cancel이 아님). 이 순서를 바꾸면 셀 편집이 유실된다.
3. **낙관적 갱신 금지**: 로컬 상태(setState)는 **저장 성공 후에만** 갱신한다.
   기존 코드의 `if (!(await persist(...)))) return;` 패턴을 유지할 것.
4. **savers는 컴포넌트 생애 동안 단일 인스턴스**: `useRef(createDebouncedSaver(...)).current` 패턴 유지.
   beforeunload + 언마운트 시 `flushAll()` 하는 effect도 함께 이동해야 한다.
5. **CSS 클래스명/DOM 구조 변경 금지**: styles.css는 클래스 셀렉터 기반. 분리한 컴포넌트가 렌더하는
   DOM은 분리 전과 동일해야 한다 (아래 6번 그리드 제약 포함).
6. **CSS Grid 평탄 구조**: 시트 전체(`div.sheet`)는 단일 CSS Grid이고 값 그리드 행들과 PDF 매핑 행들이
   **같은 grid의 직접 자식**으로 들어가 열 폭을 공유한다. 분리 컴포넌트는 반드시 **Fragment를 반환**해서
   셀 div들이 `.sheet`의 직접 자식이 되게 할 것. 래퍼 div를 추가하면 그리드가 깨진다.
   `gridTemplateColumns` 계산( zoom × columnWidths )은 `.sheet` 컨테이너를 소유한 App에 남는다.

### 검증 절차 (모든 단계 공통, 커밋 전 필수)
```
npx tsc --noEmit        # 에러 0
npx vite build          # 성공 (dist 산출물은 각 단계 커밋에 포함하지 않고, 3단계 후 일괄 커밋)
```
- dev 서버(.claude/launch.json의 "dev", port 5173)로 로드 시 콘솔 에러 0 확인.
- 단, 현재 `SKIP_LOGIN = false`라 자동화 환경에서는 로그인 화면까지만 검증 가능.
  그리드 동작(선택/복붙/드래그)은 수동 검증 항목으로 커밋 메시지에 기재하지 말 것(검증 안 된 사실을 적지 않는다).

### 커밋 규칙
- 단계당 1커밋. 메시지는 영어 명령형 제목 + 본문, 끝에:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- `node_modules/.vite/deps/_metadata.json`은 gitignore 충돌 상태이므로 절대 add하지 않는다.

---

## 1단계: useSheetSelection 훅 추출 — **[완료됨, 커밋 대기]**

> 2026-06-11 세션에서 이미 적용됨. 워킹트리에 반영돼 있고 tsc 통과 확인됨. 커밋만 남음.

### 산출물: `src/hooks/useSheetSelection.ts`
시그니처: `useSheetSelection(rows: FieldRow[], columns: ValueColumn[])` →
```ts
{
  select(point)        // pointerdown: 선택 시작(selectingRef=true) + anchor=focus=point
  focus(point)         // input focus: 드래그 중이 아닐 때만 단일 선택
  extend(point)        // pointerenter: 드래그 중일 때만 focus 갱신
  setRange(anchor, focus)  // 붙여넣기 결과 범위 선택
  clear()              // load()/로그아웃 시
  clearIfRow(rowId)    // 행 삭제 시: 선택 끝점이 이 행이면 해제
  clearIfColumn(colId) // 열 삭제 시: 동일
  getCellClass(rowId, columnId?)  // "sheetCell [selectedSheetCell] [activeSheetCell]" 문자열
  handleCopy(event)    // 시트 컨테이너의 onCopyCapture: 선택 범위를 탭 구분 텍스트로 클립보드에
}
```
- `SheetCellPoint` 타입(`{ rowId: string; columnId?: string }`)은 이 파일에서 export.
- 훅이 자체적으로 `window pointerup` 리스너를 등록해 드래그 선택을 종료한다
  (분리 전에는 App의 열 리사이즈용 pointerup 핸들러에 섞여 있었음).
- 선택 사각형 범위는 id를 rows/columns의 **현재 인덱스**로 변환해 계산 → 행 재정렬에도 의미 유지.

### App.tsx에서 제거/교체된 것
- 제거: `SheetCellPoint`/`SheetSelection` 타입, `sheetSelection` state, `selectingRef`,
  `selectSheetCell`/`focusSheetCell`/`extendSheetSelection`/`getSheetPointIndexes`/
  `getSheetSelectionBounds`/`getSheetCellCopyValue`/`handleSheetCopy`/`getSheetCellClass` (~120줄).
- 추가: `const selection = useSheetSelection(rows, columns);` (rows/columns state 선언 직후).
- 호출부 교체 맵:
  | 이전 | 이후 |
  |---|---|
  | `setSheetSelection(undefined)` (load, 로그아웃 effect) | `selection.clear()` |
  | `setSheetSelection({anchor, focus})` (pasteSheetCells) | `selection.setRange(anchor, focus)` |
  | deleteRow 안의 조건부 해제 | `selection.clearIfRow(rowId)` |
  | deleteColumn 안의 조건부 해제 | `selection.clearIfColumn(columnId)` |
  | JSX `getSheetCellClass(...)` | `selection.getCellClass(...)` |
  | JSX `selectSheetCell` / `focusSheetCell` / `extendSheetSelection` | `selection.select` / `.focus` / `.extend` |
  | JSX `onCopyCapture={handleSheetCopy}` | `onCopyCapture={selection.handleCopy}` |
  | App pointerup의 `selectingRef.current = false` | 삭제(훅이 자체 처리) |

### 커밋 메시지
```
Extract sheet selection logic into useSheetSelection hook

Move sheet range selection state, drag/focus/extend handlers, selection
bounds math, cell class computation, and clipboard copy out of App into
src/hooks/useSheetSelection.ts. The hook owns its own window pointerup
listener; App's pointerup now only ends column resizing. Behavior is
unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## 2단계: 표현 컴포넌트 분리 (SheetGrid / PdfMappingSection / StatusOverlays)

> 원칙: **상태가 없는(또는 순수 로컬 UI 상태만 갖는) 표현 컴포넌트**로 JSX만 옮긴다.
> 데이터와 도메인 콜백은 전부 App이 소유하고 props로 내려보낸다. 로직 수정 금지, 복사-이동만.

### 2-1. `src/components/StatusOverlays.tsx`
App JSX 말미의 오버레이 3종을 한 파일로. 각각 독립 export (또는 단일 컴포넌트 — 단일 권장):
```ts
type Props = {
  busyFeedback?: { title: string; description: string };
  uploadNotice?: { tone: "success" | "error"; title: string; description: string };
  imagePreview?: { name: string; url: string };
  onCloseImagePreview: () => void;
};
export function StatusOverlays(props: Props)
```
- 옮길 JSX: `imagePreview ? <div className="modalBackdrop imagePreviewBackdrop">…`,
  `busyFeedback ? <div className="downloadOverlay">…`, `uploadNotice ? <div className="uploadToast …">…`
  (App.tsx 렌더 마지막 3블록). DOM 그대로.
- `BusyFeedback`/`CellImagePreview`/`UploadNotice` 타입 정의도 이 파일로 이동하고 export.
  App은 import해서 state 타입으로 사용.
- lucide 아이콘 import(Loader2, X)도 함께 이동.

### 2-2. `src/components/SheetGrid.tsx`
값 입력 그리드: 헤더 행(열 이름/복사/삭제/리사이즈 핸들) + 데이터 행들(라벨 셀 + 값 셀) + "항목 추가" 행.
**Fragment 반환** (불변식 6).

```ts
type Props = {
  rows: FieldRow[];
  columns: ValueColumn[];
  busyId?: string;                                  // 열 복사 버튼 disabled 판정
  selection: ReturnType<typeof useSheetSelection>;  // 훅 결과 객체를 통째로 전달
  onUpdateColumnName(columnId: string, name: string): void;
  onDuplicateColumn(column: ValueColumn): void;
  onDeleteColumn(columnId: string): void;
  onAddColumn(): void;
  onAddRow(): void;
  onUpdateRow(rowId: string, label: string): void;
  onDeleteRow(rowId: string): void;
  onMoveRow(draggedRowId: string, targetRowId: string): void;
  onUpdateCell(columnId: string, rowId: string, value: string): void;
  onPaste(event: ClipboardEvent<HTMLInputElement>, rowId: string, columnId?: string): void;  // handleSheetPaste
  onUploadCellImage(column: ValueColumn, rowId: string, file: File): void;
  onPreviewCellImage(column: ValueColumn, rowId: string): void;
  onClearCellImage(column: ValueColumn, rowId: string): void;
  onColumnResizeStart(columnId: string, clientX: number): void;  // 아래 참고
  getColumnWidth(columnId: string): number;          // 리사이즈 시작값용
};
```
- **`draggingRowId` state는 SheetGrid 내부로 이동** (`useState<string>()`). 행 드래그 표시/드롭 처리는
  순수 그리드 로컬 UI이므로 App에서 제거.
- 열 리사이즈: `resizeRef`/`columnWidths`/pointermove effect는 App에 남는다
  (`gridTemplateColumns`가 App 소유이므로). SheetGrid의 리사이즈 핸들 onPointerDown은
  `onColumnResizeStart(column.id, event.clientX)`만 호출하고, App이
  `resizeRef.current = { columnId, startX: clientX, startWidth: getColumnWidth(columnId) }`를 설정.
- 옮길 JSX 범위: `<div className="sheetCell sheetHead stickyCol">항목</div>` 부터
  "항목 추가" 행(`addRowLabel` + `addRowCell`들 + `emptyAddColumnCell`)까지.
- CellImageControl import도 SheetGrid로 이동.

### 2-3. `src/components/PdfMappingSection.tsx`
PDF 매핑 밴드: 섹션 라벨 행 + 열별 일괄 다운로드 행 + PDF 행들 + "PDF 행 추가" 행.
**Fragment 반환**.

```ts
type Props = {
  columns: ValueColumn[];
  pdfRows: PdfSlotRow[];
  busyId?: string;                       // 일괄(columnId) / 단건(`${columnId}:${pdfRowId}`) disabled 판정
  hasAreas(pdfRowId: string): boolean;   // App: areasForPdfRow(id).length > 0
  onUpdatePdfRow(pdfRowId: string, label: string): void;
  onDeletePdfRow(pdfRowId: string): void;
  onAddPdfRow(): void;
  onUploadPdf(pdfRow: PdfSlotRow, file: File | undefined): void;   // uploadCommonPdf
  onOpenSetup(pdfRow: PdfSlotRow, column?: ValueColumn): void;     // setActiveSetup
  onDownloadOne(column: ValueColumn, pdfRow: PdfSlotRow): void;    // downloadFilledPdf
  onDownloadColumn(column: ValueColumn): void;                     // downloadPdfColumn
};
```
- **`pdfDropTarget` state + handlePdfDragOver/DragLeave/Drop 3개 함수는 이 컴포넌트 내부로 이동**
  (드롭 하이라이트는 순수 로컬 UI). Drop은 내부에서 `onUploadPdf(pdfRow, event.dataTransfer.files[0])` 호출.
- 옮길 JSX 범위: `sectionLabelCell` 행부터 "PDF 행 추가" 행까지.
- `DragEvent` 타입 import 포함, lucide 아이콘(FileDown, FileText, Pencil, SlidersHorizontal, Trash2, Upload)도 이동.

### 2단계 후 App.tsx 렌더 구조
```tsx
<section ref={sheetWrapRef} className="sheetWrap" onCopyCapture={selection.handleCopy} style={...}>
  <div className="sheet" style={{ gridTemplateColumns: ... }}>
    <SheetGrid ... />
    <PdfMappingSection ... />
  </div>
</section>
...
<StatusOverlays busyFeedback={busyFeedback} uploadNotice={uploadNotice}
  imagePreview={imagePreview} onCloseImagePreview={() => setImagePreview(undefined)} />
```
- App에서 빠지는 것: `draggingRowId`, `pdfDropTarget` state, PDF drag 핸들러 3개, 오버레이 JSX,
  사용처 없어진 lucide import 정리 (`닫기` X 아이콘은 StatusOverlays로).
- `closeCellImagePreview` 함수는 인라인 화살표로 대체 가능하면 제거.

### 커밋 메시지
```
Split sheet grid, PDF mapping band, and status overlays out of App

Move the value grid (header/data/add rows) into SheetGrid, the PDF
mapping band into PdfMappingSection, and the busy/toast/image-preview
overlays into StatusOverlays. Both grid components return fragments so
their cells stay direct children of the shared .sheet CSS grid. Row-drag
and PDF-drop highlight state move into the components as local UI state;
data and domain callbacks stay in App and flow down as props. Behavior
is unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## 3단계: 도메인 훅 분리 (useSheetData / usePdfData)

> 원칙: 상태+세이버+CRUD를 도메인별 훅으로. **훅끼리 직접 의존 금지** — 선택(selection) 연동과
> 도메인 간 데이터 전달은 App이 반환값으로 오케스트레이션한다(순환 의존 방지).

### 3-0. 공용 헬퍼: `src/lib/persist.ts`
App의 `persist`를 함수형으로 일반화:
```ts
/** 영속화 호출을 감싸 실패 시 onError를 호출하고 성공 여부를 돌려준다.
 *  낙관적 상태 갱신을 "저장 성공 후"로 미루는 데 쓴다. */
export async function persist(action: () => Promise<unknown>, onError: () => void): Promise<boolean> {
  try { await action(); return true; }
  catch (error) { console.error("[persist] failed", error); onError(); return false; }
}
```
두 훅이 import. App에 있던 동명 함수와 notifySaveError 정의는 훅 쪽으로 흡수.

### 3-1. `src/hooks/useSheetData.ts`
```ts
export function useSheetData(options: {
  notify(notice: UploadNotice): void;                    // 토스트
  setBusyFeedback(feedback?: BusyFeedback): void;        // 블로킹 오버레이
  setBusyId(id?: string): void;                          // 버튼 disabled
}): {
  rows: FieldRow[];
  columns: ValueColumn[];
  load(): Promise<void>;                                 // getRows+getColumns 로드/정렬
  reset(): void;                                         // 로그아웃 시 비우기
  createStarterSheet(): Promise<void>;
  addRow / updateRow / deleteRow / moveRow;
  addColumn / updateColumnName / duplicateColumn / deleteColumn;
  updateCell / pasteSheetCells / handleSheetPaste;
  uploadCellImage / clearCellImage / getCellImageUrl;    // getCellImageUrl: 미리보기 URL만 반환
  flushAll(): Promise<void>;                             // columnSaver.flushAll (외부 노출 불필요해지면 생략)
}
```
이동 대상 (App → 훅, 로직 무수정):
- `rows`/`columns` state, `rowSaver`/`columnSaver`(useRef 패턴 유지), saver용 beforeunload flush effect
  (pdfRowSaver 부분은 usePdfData로 — effect를 둘로 쪼갠다).
- `createStarterSheet/addRow/updateRow/moveRow/deleteRow/addColumn/duplicateColumn/updateColumnName/
  updateCell/pasteSheetCells/handleSheetPaste/uploadCellImage/clearCellImage`,
  모듈 레벨 `parsePastedCells`/`isMultiCellPaste`/`initialRows`.
- `duplicateColumn`의 adjust 복제는 **분리 지점**: 훅은 열 복사까지만 하고
  `duplicateColumn(source): Promise<ValueColumn | undefined>`로 새 열을 반환,
  **App이 이어서 `pdfData.copyAdjustsForColumn(source.id, copied.id)` 호출** (아래 3-2).
  busy 표시/에러 토스트는 App이 감싸도 되고 훅이 해도 됨 — 훅이 기존 try/catch 유지가 단순.
  단 adjust 복제 실패도 기존처럼 같은 에러 토스트로 묶이려면: 훅의 duplicateColumn은
  저장까지 성공한 새 열을 반환만 하고, **try/catch+busy 전체를 App으로 올린다** (권장).
- **selection 연동 제거**: 훅은 selection을 모른다. 반환값/App 체이닝으로 대체:
  - `deleteRow(rowId)` → `Promise<boolean>` 반환. App: `if (await sheet.deleteRow(id)) selection.clearIfRow(id);`
  - `deleteColumn(columnId)` → 동일하게 boolean. App이 `clearIfColumn`.
  - `pasteSheetCells` → 결과 선택 범위 `{ anchor, focus } | undefined` 반환. App이 `selection.setRange(...)`.
    `handleSheetPaste`는 이 때문에 App에 남기거나, 훅이 `onSelectRange` 콜백 옵션을 받는 방식 중
    **콜백 옵션 방식을 택한다** (options에 `onSelectRange(anchor, focus): void` 추가 — 단방향이라 순환 없음).
- `openCellImagePreview`는 App에 남는다 (imagePreview state가 App 소유).
  훅은 `repository.getCellImageUrl` 호출부만 노출하거나 App이 repository 직접 호출 — **App 직접 호출 유지**(단순).

### 3-2. `src/hooks/usePdfData.ts`
```ts
export function usePdfData(options: {
  notify(notice: UploadNotice): void;
  setBusyFeedback(feedback?: BusyFeedback): void;
  setBusyId(id?: string): void;
}): {
  pdfRows: PdfSlotRow[];
  baseAreas: PdfArea[];           // 외부 노출은 areasForPdfRow로 충분하면 생략 가능
  font?: FontAsset;
  load(): Promise<void>;          // pdfRows+areas+adjusts+font
  reset(): void;
  reloadPdfData(): Promise<void>; // 모달 onSaved
  areasForPdfRow(pdfRowId): PdfArea[];
  findAdjust(columnId, pdfRowId): ColumnPdfAdjust | undefined;
  addPdfRow / updatePdfRow / deletePdfRow / uploadCommonPdf;
  uploadFont / clearFont;         // 현재 UI 미사용이어도 그대로 이동
  copyAdjustsForColumn(sourceColumnId: string, target: ValueColumn): Promise<void>;  // duplicate 연동
  downloadFilledPdf(column: ValueColumn, pdfRow: PdfSlotRow, rows: FieldRow[]): Promise<void>;
  downloadPdfColumn(column: ValueColumn, rows: FieldRow[]): Promise<void>;
}
```
이동 대상: `pdfRows`/`baseAreas`/`adjusts`/`font` state, `pdfRowSaver`+flush effect,
`addPdfRow/updatePdfRow/deletePdfRow/uploadCommonPdf/uploadFont/clearFont/areasForPdfRow/findAdjust/
reloadPdfData/exportColumnPdf/downloadFilledPdf/downloadPdfColumn`.
- **다운로드 함수는 시트 데이터(rows)를 인자로 받는다** — 훅 간 의존을 끊는 핵심.
  (column은 이미 인자였음. `exportColumnPdf` 내부의 `rows`/`font`/`findAdjust` 중 rows만 외부 주입.)
- `copyAdjustsForColumn`: duplicateColumn에서 분리된 adjust 복제 부분.
  `adjusts.filter(a => a.columnId === sourceColumnId)`를 target.id로 재키잉해 저장 + 로컬 state 반영.
- `deletePdfRow`는 기존처럼 areas/adjusts 로컬 state도 함께 필터링.

### 3-3. App.tsx 잔여 책임 (최종 ~350줄 예상)
- auth state/effect, `user` 분기 렌더 (authShell 2종).
- `busyId`/`busyFeedback`/`uploadNotice`(+자동 닫힘 effect)/`imagePreview`/`activeSetup` state.
- `sheetZoom` + ctrl+wheel effect, `columnWidths`/`resizeRef` + pointermove effect.
- 훅 두 개 + selection 훅 wiring, 로그인/로그아웃 시 `Promise.all([sheet.load(), pdf.load()])` / 양쪽 `reset()`.
- duplicateColumn 오케스트레이션(busy 세팅 → sheet.duplicateColumn → pdf.copyAdjustsForColumn → 토스트).
- 레이아웃 JSX (topBar, emptySheet, sheetWrap, SheetGrid/PdfMappingSection/PdfSetupModal/StatusOverlays 조립).

### 주의사항
- 로그아웃 effect의 기존 동작: rows/columns/pdfRows/areas/adjusts/font 비우기 + selection.clear().
  → `sheet.reset(); pdf.reset(); selection.clear();` 로 동일하게.
- `load()`가 기존에 한 번의 Promise.all(6개)이던 것이 2개 훅의 load로 나뉜다.
  병렬 유지: `await Promise.all([sheet.load(), pdf.load()])`. 정렬 로직(createdAt asc)은 각 훅으로.
- 훅 내부 함수가 옛 이름 그대로인지 diff로 확인 — 이름 바꾸지 말 것(리뷰 가능성 유지).
- `uploadNotice` 자동 닫힘 effect(에러 5000ms/성공 2200ms)는 App에 남는다(uploadNotice가 App 소유).

### 커밋 메시지
```
Move sheet and PDF domain logic into useSheetData/usePdfData hooks

useSheetData owns rows/columns state, the row/column debounced savers,
CRUD, multi-cell paste, and cell image writes. usePdfData owns PDF rows,
base areas, per-column adjusts, the font asset, uploads, and PDF
downloads (taking sheet rows as an argument so the hooks stay
independent). App keeps auth, busy/notice/zoom/resize UI state and
orchestrates cross-domain flows (column duplication, selection updates
after delete/paste). Behavior is unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## 마무리 단계 (3단계 커밋 후)
1. `npx vite build` 후 `git add dist` → 커밋 `Update build output`.
2. App.tsx 최종 줄 수 보고 (목표 달성 여부: ≤ 450줄이면 성공).
3. 이 문서의 "[완료됨]" 마커를 단계 진행에 맞춰 갱신.
