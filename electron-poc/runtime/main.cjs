const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const { spawn } = require("node:child_process");
const { readFile, writeFile, unlink } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const automationScript = path.join(__dirname, "hwp-automation.ps1");
const mappingScript = path.join(__dirname, "hwp-mapping-session.ps1");
let mappingSession;

const hwpErrorMessages = {
  HWP_AUTOMATION_NOT_FOUND: "한글 자동화 구성 요소를 찾지 못했습니다.",
  HWP_OPEN_FAILED: "한글 양식을 열지 못했습니다. 한글의 확인 창과 파일 사용 여부를 확인해 주세요.",
  MAPPING_SESSION_NOT_STARTED: "먼저 빈 양식 매핑을 시작해 주세요.",
  FIELD_NAME_EMPTY: "입력 이름이 비어 있습니다.",
  FIELD_ASSIGN_FAILED: "현재 한글 위치에 필드를 지정하지 못했습니다. 표 셀 안을 클릭한 뒤 다시 시도해 주세요.",
  MAPPED_TEMPLATE_SAVE_FAILED: "매핑된 한글 양식을 저장하지 못했습니다.",
  MAPPING_ACTION_UNSUPPORTED: "지원하지 않는 한글 매핑 요청입니다.",
  TEMPLATE_NOT_FOUND: "선택한 한글 양식 파일을 찾지 못했습니다.",
  HWP_SAVE_FAILED: "결과 HWP를 저장하지 못했습니다.",
  AUTOMATION_ACTION_UNSUPPORTED: "지원하지 않는 한글 자동화 요청입니다.",
};

function friendlyHwpError(message) {
  const text = String(message || "").trim();
  const code = Object.keys(hwpErrorMessages).find((key) => text.includes(key));
  return code ? hwpErrorMessages[code] : text || "한글 자동화에 실패했습니다.";
}

class HwpMappingSession {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.process = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mappingScript],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.handleOutput(chunk));
    this.process.stderr.on("data", (chunk) => {
      this.lastError = `${this.lastError || ""}${chunk}`;
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) console.error(`[HWP mapping] ${line}`);
      }
    });
    this.process.on("exit", () => {
      const message = (this.lastError || "한글 매핑 세션이 종료되었습니다.").trim();
      for (const pending of this.pending.values()) pending.reject(new Error(message));
      this.pending.clear();
    });
  }

  handleOutput(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending) continue;
        this.pending.delete(response.id);
        if (response.ok) pending.resolve(response.result);
        else {
          console.error("[HWP mapping] request failed", response.result || response.message);
          pending.reject(new Error(friendlyHwpError(response.message)));
        }
      } catch {}
    }
  }

  request(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = String(this.nextId++);
      this.pending.set(id, { resolve, reject });
      const requestJson = JSON.stringify({ id, action, ...payload });
      const encodedRequest = Buffer.from(requestJson, "utf8").toString("base64");
      this.process.stdin.write(`${encodedRequest}\n`, "ascii");
    });
  }

  close() {
    if (!this.process.killed) this.process.kill();
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#eef1f4",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}/poc`);
  } else {
    void window.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"), { hash: "/poc" });
  }
}

function runPowerShell(payload) {
  return new Promise(async (resolve, reject) => {
    const payloadPath = path.join(os.tmpdir(), `hwp-poc-${crypto.randomUUID()}.json`);
    await writeFile(payloadPath, JSON.stringify(payload), "utf8");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", automationScript, "-PayloadPath", payloadPath],
      { windowsHide: true, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 120000 },
      async (error, stdout, stderr) => {
        await unlink(payloadPath).catch(() => undefined);
        if (error) {
          const message = error.killed
            ? "한글 자동화가 2분 안에 끝나지 않았습니다. 한글의 확인 창이나 최초 실행 화면을 확인해 주세요."
            : friendlyHwpError(stderr || stdout || error.message);
          reject(new Error(message));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim() || "{}"));
        } catch {
          reject(new Error("한글 자동화 응답을 읽지 못했습니다."));
        }
      },
    );
  });
}

ipcMain.handle("hwp:status", async () => {
  const status = await runPowerShell({ action: "status" });
  return {
    available: Boolean(status.available),
    message: status.available ? "한글 자동화를 사용할 수 있습니다." : "한글 프로그램을 찾지 못했습니다.",
  };
});

ipcMain.handle("hwp:get-poc-sample", async () => {
  const downloads = app.getPath("downloads");
  const blankPath = path.join(downloads, "참여기업_참여자()_멘토()_면담일지.hwp");
  const patternPath = path.join(downloads, "(주)피에로컴퍼니_참여자(임동건)_멘토(전석준)_면담일지 (1).hwp");
  try {
    await Promise.all([readFile(blankPath), readFile(patternPath)]);
    return { blankPath, patternPath };
  } catch {
    return null;
  }
});

ipcMain.handle("hwp:pick-template", async () => {
  const result = await dialog.showOpenDialog({
    title: "한글 양식 선택",
    properties: ["openFile"],
    filters: [{ name: "한글 문서", extensions: ["hwp", "hwpx"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("hwp:inspect-fields", (_event, templatePath) =>
  runPowerShell({ action: "inspect", templatePath }),
);

ipcMain.handle("hwp:mapping-start", async (_event, templatePath) => {
  if (mappingSession) {
    try { await mappingSession.request("close"); } catch {}
    mappingSession.close();
  }
  mappingSession = new HwpMappingSession();
  return mappingSession.request("open", { templatePath });
});

ipcMain.handle("hwp:mapping-assign", (_event, fieldName) => {
  if (!mappingSession) throw new Error("먼저 양식 매핑을 시작해 주세요.");
  return mappingSession.request("assign", { fieldName });
});

ipcMain.handle("hwp:mapping-save", async () => {
  if (!mappingSession) throw new Error("진행 중인 양식 매핑이 없습니다.");
  const result = await dialog.showSaveDialog({
    title: "매핑된 한글 양식 저장",
    defaultPath: "면담일지_매핑양식.hwp",
    filters: [{ name: "한글 문서", extensions: ["hwp"] }],
  });
  if (result.canceled || !result.filePath) return null;
  return mappingSession.request("save", { outputPath: result.filePath });
});

ipcMain.handle("hwp:mapping-close", async () => {
  if (!mappingSession) return;
  try { await mappingSession.request("close"); } finally {
    mappingSession.close();
    mappingSession = undefined;
  }
});

ipcMain.handle("hwp:generate", async (_event, request) => {
  const defaultName = String(request.suggestedName || "자동작성_결과.hwp").replace(/[\\/:*?"<>|]/g, "");
  let outputPath;
  if (request.previewOnly) {
    outputPath = path.join(os.tmpdir(), `hwp-poc-preview-${crypto.randomUUID()}.hwp`);
  } else {
    const result = await dialog.showSaveDialog({
      title: "결과 HWP 저장",
      defaultPath: defaultName.endsWith(".hwp") ? defaultName : `${defaultName}.hwp`,
      filters: [{ name: "한글 문서", extensions: ["hwp"] }],
    });
    if (result.canceled || !result.filePath) return null;
    outputPath = result.filePath;
  }
  const previewPath = outputPath.replace(/\.hwp$/i, "_미리보기.pdf");
  return runPowerShell({
    action: "generate",
    templatePath: request.templatePath,
    outputPath,
    previewPath,
    values: request.values,
    replacements: request.replacements || [],
  });
});

ipcMain.handle("hwp:read-file", async (_event, filePath) => {
  const bytes = await readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
});

ipcMain.handle("hwp:open-path", async (_event, filePath) => shell.openPath(filePath));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (mappingSession) mappingSession.close();
  if (process.platform !== "darwin") app.quit();
});
