import { readFileSync } from "node:fs";

function assertContains(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}`);
  }
}

function assertNotContains(source: string, unexpected: string, message: string) {
  if (source.includes(unexpected)) {
    throw new Error(`${message}\nUnexpected: ${unexpected}`);
  }
}

const settlementPanel = readFileSync("src/components/SettlementPanel.tsx", "utf8");
const appCss = readFileSync("src/App.css", "utf8");
const tauriConfig = readFileSync("src-tauri/tauri.conf.json", "utf8");

assertContains(
  settlementPanel,
  "useDefaultSource",
  "Settlement page should expose a default payment info toggle",
);
assertContains(
  settlementPanel,
  "使用默认渠道打款信息表",
  "Settlement page should label the default payment info toggle clearly",
);
assertContains(
  settlementPanel,
  "sourcePath: useDefaultSource ? \"\" : sourcePath",
  "Settlement generation should use the bundled default only when the toggle is enabled",
);
assertContains(
  settlementPanel,
  "!useDefaultSource &&",
  "Settlement page should show the payment info picker only when the default source is disabled",
);
assertContains(
  settlementPanel,
  'label="渠道打款信息表"',
  "Settlement page should still support manually selecting the payment info file",
);
assertNotContains(
  settlementPanel,
  "const canGenerate = settlementPath && outputDir && !isGenerating;",
  "Manual payment info mode should require a selected payment info file before generating",
);
assertContains(
  settlementPanel,
  "useDefaultSource || sourcePath",
  "Generate button should allow default mode or require sourcePath in manual mode",
);
assertContains(
  settlementPanel,
  "settlement-result-list",
  "Generated settlement files should render inside a bounded scroll container",
);
assertContains(
  settlementPanel,
  "SETTLEMENT_OUTPUT_BASE_STORAGE_KEY",
  "Settlement page should remember the selected base output directory",
);
assertContains(
  settlementPanel,
  "localStorage.getItem(SETTLEMENT_OUTPUT_BASE_STORAGE_KEY)",
  "Settlement page should restore the remembered base output directory",
);
assertContains(
  settlementPanel,
  "localStorage.setItem(SETTLEMENT_OUTPUT_BASE_STORAGE_KEY, nextValue)",
  "Settlement page should persist the selected base output directory",
);
assertContains(
  settlementPanel,
  "outputDir: outputBaseDir",
  "Settlement generation should pass the base output directory and let the backend create the dated directory",
);
assertContains(
  settlementPanel,
  "本次输出目录",
  "Settlement page should show the dated directory that will be used for this run",
);
assertContains(
  appCss,
  ".settlement-result-list",
  "Generated settlement files scroll container should have CSS",
);
assertContains(
  appCss,
  "max-height: 240px",
  "Generated settlement files scroll container should be height-bounded",
);
assertContains(
  appCss,
  "overflow-y: auto",
  "Generated settlement files scroll container should scroll vertically",
);
assertContains(
  tauriConfig,
  "../resources/**/*",
  "Tauri bundle should include project resources such as the default payment info file",
);
