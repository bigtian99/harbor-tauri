import { readFileSync } from "node:fs";
import { isOpsTab, resolveOpsInitialTab, resolveTabForOpsMode } from "../src/opsNavigation.ts";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

assertEqual(isOpsTab("landing"), true, "landing should be visible in ops mode");
assertEqual(isOpsTab("settlement"), true, "settlement should be visible in ops mode");
assertEqual(isOpsTab("packSpeed"), true, "pack speed should be visible in ops mode");
assertEqual(isOpsTab("branch"), false, "branch package should be hidden in ops mode");

assertEqual(
  resolveOpsInitialTab("upload"),
  "landing",
  "ops mode should redirect non-ops tabs to landing on startup"
);
assertEqual(
  resolveOpsInitialTab("settlement"),
  "settlement",
  "ops mode should not force a visible ops tab back to landing"
);
assertEqual(
  resolveOpsInitialTab("packSpeed"),
  "packSpeed",
  "ops mode should keep pack speed selected when switching menus"
);
assertEqual(resolveTabForOpsMode("settlement", true), "settlement", "ops tab changes should keep settlement");
assertEqual(resolveTabForOpsMode("config", true), "landing", "ops tab changes should reject hidden config tab");
assertEqual(resolveTabForOpsMode("config", false), "config", "normal tab changes should keep config");

// 前端重构后 ops 导航逻辑在 hooks/useAppConfig，App 仅接线 handleTabChange
const appSource = readFileSync("src/App.tsx", "utf8");
const appConfigSource = readFileSync("src/hooks/useAppConfig.ts", "utf8");

if (!appConfigSource.includes("resolveOpsInitialTab")) {
  throw new Error("useAppConfig should use resolveOpsInitialTab when entering ops mode");
}

if (!appConfigSource.includes("opsModeInitializedRef")) {
  throw new Error("useAppConfig should guard ops-mode landing initialization so menu clicks are not reset later");
}

if (!appConfigSource.includes("handleTabChange")) {
  throw new Error("useAppConfig should expose handleTabChange for the ops-mode guard");
}

if (!appSource.includes("app.handleTabChange")) {
  throw new Error("App should route sidebar tab clicks through handleTabChange");
}

if (appConfigSource.includes('setActiveTab("landing");')) {
  throw new Error("useAppConfig should not force every ops-mode check back to landing");
}
