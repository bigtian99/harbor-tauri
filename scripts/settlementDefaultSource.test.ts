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

assertNotContains(
  settlementPanel,
  "useDefaultSource",
  "Settlement page should not expose a default payment info toggle",
);
assertNotContains(
  settlementPanel,
  "使用默认渠道打款信息表",
  "Settlement page should not show the default payment info label",
);
assertNotContains(
  settlementPanel,
  "sourcePath: useDefaultSource ? \"\" : sourcePath",
  "Settlement generation should always pass the selected payment info file",
);
assertNotContains(
  settlementPanel,
  "!useDefaultSource &&",
  "Settlement page should always show the payment info picker",
);
assertContains(
  settlementPanel,
  'label="渠道打款信息表"',
  "Settlement page should require manually selecting the payment info file",
);
assertContains(
  settlementPanel,
  "const canGenerate = sourcePath && settlementPath && outputBaseDir && !isGenerating;",
  "Settlement generation should require both source and settlement files",
);
assertNotContains(
  settlementPanel,
  "useDefaultSource || sourcePath",
  "Generate button should not allow default payment info mode",
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
assertNotContains(
  tauriConfig,
  "../resources/**/*",
  "Tauri bundle should not include the old default payment info resource",
);
