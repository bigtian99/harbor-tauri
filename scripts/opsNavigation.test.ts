import { readFileSync } from "node:fs";
import { isOpsTab, resolveOpsInitialTab, resolveTabForOpsMode } from "../src/opsNavigation";

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

const appSource = readFileSync("src/App.tsx", "utf8");

if (!appSource.includes("resolveOpsInitialTab")) {
  throw new Error("App should use resolveOpsInitialTab when entering ops mode");
}

if (!appSource.includes("opsModeInitializedRef")) {
  throw new Error("App should guard ops-mode landing initialization so menu clicks are not reset later");
}

if (!appSource.includes("handleTabChange")) {
  throw new Error("App should route sidebar tab clicks through the ops-mode guard");
}

if (appSource.includes('setActiveTab("landing");')) {
  throw new Error("App should not force every ops-mode check back to landing");
}
