import test from "node:test";
import assert from "node:assert/strict";
import { resolveBatchSpringProfile, describeBatchMavenCommand } from "../src/utils/ksBatchSpringProfile.ts";

test("undefined 覆盖 = 沿用仓库记忆的 profile", () => {
  assert.equal(resolveBatchSpringProfile("prod", undefined), "prod");
  assert.equal(resolveBatchSpringProfile(" test ", undefined), "test");
});

test("显式空串 = 不指定 profile", () => {
  assert.equal(resolveBatchSpringProfile("prod", ""), "");
  assert.equal(resolveBatchSpringProfile("prod", "   "), "");
});

test("显式值覆盖记忆值并 trim", () => {
  assert.equal(resolveBatchSpringProfile("prod", " staging "), "staging");
  assert.equal(resolveBatchSpringProfile("", "test"), "test");
});

test("Maven 命令展示与分支打包一致", () => {
  assert.equal(
    describeBatchMavenCommand("test"),
    "mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=test",
  );
  assert.equal(
    describeBatchMavenCommand(""),
    "mvn clean package -Dmaven.test.skip=true",
  );
});
