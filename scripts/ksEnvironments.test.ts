import test from "node:test";
import assert from "node:assert/strict";

import {
  createKsEnvironment,
  nextKsEnvName,
  pickKsEnvironment,
  resolveKsEnvironments,
} from "../src/utils/ksEnvironments.ts";
import type { HarborConfig } from "../src/types.ts";

function cfg(partial: Partial<HarborConfig>): HarborConfig {
  return partial as HarborConfig;
}

test("resolveKsEnvironments prefers list and migrates legacy fields", () => {
  const fromList = resolveKsEnvironments(cfg({
    ks_environments: [{ id: "prod", name: "prod", console: "http://p", username: "u", password: "x" }],
    ks_username: "old",
    ks_password: "old",
  }));
  assert.equal(fromList.length, 1);
  assert.equal(fromList[0].name, "prod");

  const fromLegacy = resolveKsEnvironments(cfg({
    ks_console: "http://dev",
    ks_username: "admin",
    ks_password: "pw",
  }));
  assert.equal(fromLegacy.length, 1);
  assert.equal(fromLegacy[0].name, "dev");
  assert.equal(fromLegacy[0].console, "http://dev");

  assert.deepEqual(resolveKsEnvironments(cfg({})), []);
});

test("next env name fills dev/test/prod then env-n", () => {
  assert.equal(nextKsEnvName([]), "dev");
  assert.equal(nextKsEnvName([{ id: "1", name: "dev", console: "", username: "", password: "" }]), "test");
  const three = ["dev", "test", "prod"].map((name) => ({
    id: name, name, console: "", username: "", password: "",
  }));
  assert.equal(nextKsEnvName(three), "env-4");
});

test("pickKsEnvironment falls back when last id is missing", () => {
  const envs = [
    { id: "dev", name: "dev", console: "", username: "", password: "" },
    { id: "prod", name: "prod", console: "", username: "", password: "" },
  ];
  assert.equal(pickKsEnvironment(envs, "prod")?.id, "prod");
  assert.equal(pickKsEnvironment(envs, "gone")?.id, "dev");
  assert.equal(createKsEnvironment([]).name, "dev");
  assert.equal(createKsEnvironment([]).console, "");
});
