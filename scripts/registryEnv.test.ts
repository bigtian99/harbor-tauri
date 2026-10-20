/**
 * 仓库环境（Harbor / Zot）：Zot 没有项目概念，前缀可留空。
 * 跑法：pnpm test（scripts/*.test.ts）
 */
import assert from "node:assert/strict";
import {
  isHarborEnvReady,
  resolveHarborRepository,
  type HarborEnv,
} from "../src/types.ts";

const harborEnv: HarborEnv = {
  id: "h1",
  name: "开发",
  registry_type: "harbor",
  url: "harbor.example.com",
  username: "admin",
  password: "secret",
  project: "team-a",
};

const zotEnv: HarborEnv = {
  id: "z1",
  name: "Zot",
  registry_type: "zot",
  url: "https://zot.example.com",
  username: "admin",
  password: "secret",
  project: "",
};

assert.equal(isHarborEnvReady(harborEnv), true);
assert.equal(isHarborEnvReady(zotEnv), true, "Zot 不要求项目/前缀");
assert.equal(
  isHarborEnvReady({ ...harborEnv, project: "" }),
  false,
  "Harbor 仍要求项目",
);
assert.equal(
  isHarborEnvReady({ ...zotEnv, password: "" }),
  false,
  "密码仍必填",
);

assert.equal(
  resolveHarborRepository("my-app", "team-a", "harbor").ok ? "ok" : "err",
  "ok",
);
assert.deepEqual(resolveHarborRepository("my-app", "team-a", "harbor"), {
  ok: true,
  repository: "team-a/my-app",
});
assert.deepEqual(
  resolveHarborRepository("my-app", "", "zot"),
  { ok: true, repository: "my-app" },
  "Zot 前缀为空时直接用镜像名",
);
assert.deepEqual(resolveHarborRepository("my-app", "team-a", "zot"), {
  ok: true,
  repository: "team-a/my-app",
});
assert.equal(
  resolveHarborRepository("my-app", "", "harbor").ok,
  false,
  "Harbor 缺项目应报错",
);
assert.deepEqual(
  resolveHarborRepository("team-a/my-app", "", "zot"),
  { ok: true, repository: "team-a/my-app" },
);

console.log("registryEnv.test.ts: ok");
