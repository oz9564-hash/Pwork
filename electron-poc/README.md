# Electron HWP POC

한글 문서 매핑 POC의 Electron 런타임과 PowerShell 자동화 파일을 모아 둔 폴더입니다.

- `runtime/`: Electron 메인 프로세스, preload, HWP COM 자동화
- `../src/features/electron-hwp-poc/`: POC 전용 React 화면, HWP 데이터 분석, Electron 타입
- `../src/styles.css`: `Electron HWP POC` 주석 아래의 전용 스타일
- `../src/hooks/useWorkspaceRouter.ts`: `/poc` 경로 한 줄
- `../src/App.tsx`: POC 화면 import와 분기
- `../package.json`: Electron 실행 명령, main, 개발 의존성

나중에 POC를 제거할 때 위 항목만 정리하면 기존 PDF 웹 기능과 분리할 수 있습니다.
