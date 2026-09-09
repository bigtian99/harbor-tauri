import test from "node:test";
import assert from "node:assert/strict";

import {
  createHarborEnvironment,
  isHarborEnvReady,
  nextHarborEnvName,
  pickHarborEnvironment,
  resolveActiveHarbor,
  resolveHarborEnvironments,
  withActiveHarborEnv,
} from "../src/utils/harborEnvironments.ts";
import type { HarborConfig } from "../src/types.ts";

function cfg(partial: Partial<HarborConfig>): HarborConfig {
  return partial as HarborConfig;
}

test("resolveHarborEnvironments prefers list and migrates legacy fields", () => {
  const fromList = resolveHarborEnvironments(cfg({
    harbor_environments: [{
      id: "prod",
      name: "生产",
      harbor_url: "h.prod",
      username: "u",
      password: "x",
      project: "p",
    }],
    harbor_url: "old",
    username: "old",
  }));
  assert.equal(fromList.length, 1);
  assert.equal(fromList[0].name, "生产");

  const fromLegacy = resolveHarborEnvironments(cfg({
    harbor_url: "dockerhub.local",
    username: "admin",
    password: "pw",
    project: "app",
  }));
  assert.equal(fromLegacy.length, 1);
  assert.equal(fromLegacy[0].name, "默认");
  assert.equal(fromLegacy[0].harbor_url, "dockerhub.local");
  assert.equal(fromLegacy[0].project, "app");

  assert.deepEqual(resolveHarborEnvironments(cfg({})), []);
});

test("next env name fills 开发/生产/测试 then 环境-n", () => {
  assert.equal(nextHarborEnvName([]), "开发");
  assert.equal(nextHarborEnvName([{
    id: "1", name: "开发", harbor_url: "", username: "", password: "", project: "",
  }]), "生产");
  const three = ["开发", "生产", "测试"].map((name) => ({
    id: name, name, harbor_url: "", username: "", password: "", project: "",
  }));
  assert.equal(nextHarborEnvName(three), "环境-4");
});

test("pick / active / withActiveHarborEnv", () => {
  const envs = [
    {
      id: "dev", name: "开发", harbor_url: "h.dev", username: "u", password: "p", project: "d",
    },
    {
      id: "prod", name: "生产", harbor_url: "h.prod", username: "u", password: "p", project: "pr",
    },
  ];
  assert.equal(pickHarborEnvironment(envs, "prod")?.id, "prod");
  assert.equal(pickHarborEnvironment(envs, "gone")?.id, "dev");

  const active = resolveActiveHarbor(cfg({
    harbor_environments: envs,
    harbor_last_env_id: "prod",
  }));
  assert.equal(active?.project, "pr");

  const patched = withActiveHarborEnv(cfg({ harbor_environments: envs }), "prod");
  assert.equal(patched.harbor_last_env_id, "prod");
  assert.equal(patched.harbor_url, "h.prod");
  assert.equal(patched.project, "pr");
  assert.equal(isHarborEnvReady(active), true);
  assert.equal(isHarborEnvReady(undefined), false);
  assert.equal(createHarborEnvironment([]).name, "开发");
});
