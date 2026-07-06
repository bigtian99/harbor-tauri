import { getRememberedBranchAdvancedSettings } from "../src/branchSettings";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

const remembered = getRememberedBranchAdvancedSettings({
  remember_branch_settings: true,
  last_spring_profile: "prod",
  last_expose_port: "8181",
  expose_port: "8080",
});

assertEqual(remembered.springProfile, "prod", "remembered spring profile should be restored");
assertEqual(remembered.exposePort, "8181", "remembered branch expose port should be restored first");

const fallback = getRememberedBranchAdvancedSettings({
  remember_branch_settings: true,
  last_spring_profile: "",
  last_expose_port: "",
  expose_port: "8080",
});

assertEqual(fallback.springProfile, "", "empty spring profile should stay empty");
assertEqual(fallback.exposePort, "8080", "default config port should fill advanced port when no branch port was saved");

const disabled = getRememberedBranchAdvancedSettings({
  remember_branch_settings: false,
  last_spring_profile: "prod",
  last_expose_port: "8181",
  expose_port: "8080",
});

assertEqual(disabled.springProfile, "", "disabled branch memory should not restore spring profile");
assertEqual(disabled.exposePort, "", "disabled branch memory should not restore expose port");
