type HwpDesktopStatus = { available: boolean; message: string };
type HwpGenerateResult = { outputPath: string; previewPath: string | null };

interface HwpDesktopBridge {
  getStatus(): Promise<HwpDesktopStatus>;
  getPocSample(): Promise<{ blankPath: string; patternPath: string } | null>;
  pickTemplate(): Promise<string | null>;
  inspectFields(templatePath: string): Promise<{ fields: string[] }>;
  startMapping(templatePath: string): Promise<{ opened: boolean }>;
  assignCurrentPosition(fieldName: string): Promise<{ fieldName: string }>;
  saveMapping(): Promise<{ outputPath: string } | null>;
  closeMapping(): Promise<void>;
  generate(request: {
    templatePath: string;
    values: Record<string, string>;
    suggestedName: string;
    previewOnly?: boolean;
    replacements?: Array<{ source: string; target: string }>;
  }): Promise<HwpGenerateResult | null>;
  readFile(filePath: string): Promise<ArrayBuffer>;
  openPath(filePath: string): Promise<string>;
}

interface Window {
  hwpDesktop?: HwpDesktopBridge;
}
