import { readFileSync } from "node:fs";
import {
  getBatchPackIdLabel,
  getBatchPackSubmitText,
  isBatchPackUnauthorized,
  parseSubChannelIds,
} from "../src/opsBatchPack.ts";

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

assertEqual(getBatchPackIdLabel("subChannel"), "子渠道 ID", "Sub channel mode should label IDs as sub channel IDs");
assertEqual(getBatchPackIdLabel("vest"), "马甲包 ID", "Vest mode should label IDs as vest package IDs");
assertEqual(getBatchPackSubmitText("vest"), "提交打包加速", "Vest mode should use acceleration wording too");

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
const utilsSource = readFileSync("src-tauri/src/utils.rs", "utf8");
const opsSource = readFileSync("src-tauri/src/ops.rs", "utf8");
const opsCapabilitySource = readFileSync("src-tauri/capabilities/ops-login.json", "utf8");

assertContains(typesSource, '"packSpeed"', "TabType should include the pack speed page");
assertContains(typesSource, "ops_authorization?: string", "Config should allow a session-only ops Authorization token without requiring a default");
assertContains(sidebarSource, 'tab: "packSpeed"', "Sidebar should show the pack speed menu in normal builds");
assertContains(sidebarSource, "isOpsTab(item.tab)", "Ops mode should keep the pack speed menu visible");
assertNotContains(panelSource, "artifact-type-selector", "Pack speed panel should not render a duplicate top tab button");
assertNotContains(panelSource, "保存 Authorization", "Pack speed panel should not show a separate save button");
assertNotContains(panelSource, "自动保存", "Pack speed panel should not claim Authorization is saved locally");
assertContains(panelSource, "不会写入本地配置", "Pack speed panel should tell users Authorization is session-only");
assertContains(panelSource, "batchPackType", "Pack speed panel should let the user choose the batch pack type");
assertContains(panelSource, "packType: batchPackType", "Pack speed panel should send the selected batch pack type to the backend");
assertContains(panelSource, 'invoke("open_ops_login_window")', "Pack speed panel should open the embedded login window");
assertContains(panelSource, "ops-auth-token-captured", "Pack speed panel should listen for captured login tokens");
assertContains(panelSource, "event.payload.ids", "Pack speed panel should accept synced IDs from supported ops lists");
assertContains(panelSource, "event.payload.packType", "Pack speed panel should switch mode when syncing IDs from a supported ops list");
assertContains(panelSource, 'setIdsText(syncedIds.join("\\n"))', "Synced IDs should use newline-separated input text");
assertContains(panelSource, "支持英文逗号", "Sub channel ID help text should mention English comma support");
assertContains(appSource, "<PackSpeedPanel", "App should render the pack speed panel");
assertNotContains(appSource, 'ops_authorization: ""', "App should not ship a default Authorization value in initial config");
assertNotContains(appSource, "const updatedConfig = { ...config, ops_authorization: authorization.trim() };", "App should not persist ops Authorization to local config");
assertContains(appSource, "ops_authorization: token", "App should keep ops Authorization only in memory");
assertContains(libSource, "batch_pack_sub_channels", "Tauri should register the batch pack command");
assertContains(libSource, "open_ops_login_window", "Tauri should register the embedded ops login command");
assertContains(libSource, "close_ops_login_window", "Tauri should register the embedded ops login close command");
assertContains(modelsSource, "skip_serializing_if = \"Option::is_none\"", "Rust config should omit missing ops Authorization during serialization");
assertContains(utilsSource, "config.ops_authorization = None", "Config normalization should clear saved ops Authorization tokens");
assertContains(opsSource, "WebviewWindowBuilder", "Ops login should use an embedded Tauri webview window");
assertContains(opsSource, "pub async fn open_ops_login_window", "Ops login window creation should use an async Tauri command to avoid Windows WebView2 deadlocks");
assertContains(opsSource, 'const VEST_BATCH_REBUILD_PATH: &str = "/pack/vest/batch-rebuild";', "Vest mode should call the vest batch rebuild path on the existing API host");
assertContains(opsSource, 'const VEST_LIST_PATH = "/pack/vest";', "Ops login should collect selected IDs on the vest list page");
assertContains(opsSource, "Self::Vest => VEST_BATCH_REBUILD_PATH", "Backend should support a vest batch pack type");
assertContains(opsSource, '"ids": ids', "Vest mode should send IDs in the ids request field");
assertContains(opsSource, "initialization_script", "Ops login should inject the auth capture script");
assertContains(opsSource, 'const OPS_LOGIN_URL: &str = "https://admintksy.tiankongshuyu.cn";', "Ops login should open the admin login site");
assertContains(opsSource, 'const HOST = "admintksy.tiankongshuyu.cn";', "Ops login capture script should be restricted to the admin login host");
assertContains(opsSource, 'const LOGIN_API_HOST = "tksyadmin.tiankongshuyu.cn";', "Ops login capture script should allow the login API host");
assertContains(opsSource, "/auth/login", "Ops login should capture only the login response");
assertContains(opsSource, "data.token", "Ops login should extract data.token from the login response");
assertContains(opsSource, "window.__JARPORTER_OPS_AUTH_LOGIN_TOKEN__ = token", "Login response should cache token without syncing immediately");
assertNotContains(opsSource, "emitToken(token);", "Login response should not auto sync token and close the login window");
assertContains(opsSource, 'localStorage.getItem("token") || window.__JARPORTER_OPS_AUTH_LOGIN_TOKEN__', "Manual sync should use localStorage token or the captured login token");
assertContains(opsSource, 'localStorage.getItem("token")', "Ops login should allow manually syncing token from localStorage");
assertContains(opsSource, 'const SUB_CHANNEL_PATH = "/alarm/channel/sub";', "Ops login should collect selected IDs on the sub channel page");
assertContains(opsSource, "collectSelectedIds", "Ops login should collect selected IDs from supported list pages");
assertContains(opsSource, 'td:nth-child(2) .cell', "Ops login should read the ID column next to the selection checkbox");
assertContains(opsSource, "packType", "Ops login should send the selected list type with synced IDs");
assertContains(opsSource, "ids", "Ops login should send selected IDs with the token");
assertContains(opsSource, "同步", "Ops login should inject a visible sync button");
assertNotContains(opsSource, "同步 token", "Ops login sync button should not mention token");
assertContains(opsSource, "plugin:event|emit_to", "Ops login should emit the token to the main window");
assertContains(opsCapabilitySource, '"ops-login"', "Ops login capability should target the login window");
assertContains(opsCapabilitySource, '"https://admintksy.tiankongshuyu.cn/*"', "Ops login capability should allow only the admin login host");
assertContains(opsCapabilitySource, '"core:event:allow-emit-to"', "Ops login capability should only need event emit-to access");
