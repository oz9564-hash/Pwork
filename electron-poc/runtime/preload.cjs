const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hwpDesktop", {
  getStatus: () => ipcRenderer.invoke("hwp:status"),
  getPocSample: () => ipcRenderer.invoke("hwp:get-poc-sample"),
  pickTemplate: () => ipcRenderer.invoke("hwp:pick-template"),
  inspectFields: (templatePath) => ipcRenderer.invoke("hwp:inspect-fields", templatePath),
  startMapping: (templatePath) => ipcRenderer.invoke("hwp:mapping-start", templatePath),
  assignCurrentPosition: (fieldName) => ipcRenderer.invoke("hwp:mapping-assign", fieldName),
  saveMapping: () => ipcRenderer.invoke("hwp:mapping-save"),
  closeMapping: () => ipcRenderer.invoke("hwp:mapping-close"),
  generate: (request) => ipcRenderer.invoke("hwp:generate", request),
  readFile: (filePath) => ipcRenderer.invoke("hwp:read-file", filePath),
  openPath: (filePath) => ipcRenderer.invoke("hwp:open-path", filePath),
});
