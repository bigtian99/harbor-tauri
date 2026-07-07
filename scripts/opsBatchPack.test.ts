import { readFileSync } from "node:fs";
import { isBatchPackUnauthorized, parseSubChannelIds } from "../src/opsBatchPack";

function assertEqual<T>(actual: T, expected: T, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
  }
}

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

assertEqual(
  parseSubChannelIds("10593, 10594\n10595 10596"),
  ["10593", "10594", "10595", "10596"],
  "Sub channel IDs should support comma, whitespace, and newline separators",
);

assertEqual(
  parseSubChannelIds("10593,,10593\n "),
  ["10593"],
  "Sub channel IDs should remove empty values and duplicates",
);

assertEqual(
  isBatchPackUnauthorized({ code: 401, unauthorized: false }),
  true,
  "Business code 401 should ask the user to refresh Authorization token",
);

assertEqual(
  isBatchPackUnauthorized({ code: 200, unauthorized: true }),
  true,
  "HTTP 401 surfaced by the backend should ask the user to refresh Authorization token",
);

const typesSource = readFileSync("src/types.ts", "utf8");
const sidebarSource = readFileSync("src/components/Sidebar.tsx", "utf8");
const panelSource = readFileSync("src/components/PackSpeedPanel.tsx", "utf8");
const appSource = readFileSync("src/App.tsx", "utf8");
const libSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const modelsSource = readFileSync("src-tauri/src/models.rs", "utf8");

assertContains(typesSource, '"packSpeed"', "TabType should include the pack speed page");
assertContains(typesSource, "ops_authorization", "Config should persist the ops Authorization token");
assertContains(sidebarSource, 'tab: "packSpeed"', "Sidebar should show the pack speed menu in normal builds");
assertContains(sidebarSource, 'i.tab === "packSpeed"', "Ops mode should keep the pack speed menu visible");
assertNotContains(panelSource, "保存 Authorization", "Pack speed panel should not show a separate save button");
assertNotContains(panelSource, "handleSaveAuthorization", "Pack speed panel should save only when submitting acceleration");
assertContains(panelSource, "await onSaveAuthorization(localAuthorization)", "Submitting acceleration should save Authorization automatically");
assertContains(panelSource, "支持英文逗号", "Sub channel ID help text should mention English comma support");
assertContains(appSource, "<PackSpeedPanel", "App should render the pack speed panel");
assertContains(appSource, "handleOpsAuthorizationSave", "App should save Authorization from the pack speed panel");
assertContains(libSource, "batch_pack_sub_channels", "Tauri should register the batch pack command");
assertContains(modelsSource, "ops_authorization", "Rust config should persist ops Authorization");
