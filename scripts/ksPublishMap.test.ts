import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGitUrl,
  lookupKsPublishMap,
  lookupKsPublishMaps,
  lookupKsPublishMapByDeployment,
  createKsPublishMap,
} from "../src/utils/ksPublishMap.ts";
import type { KsPublishMap } from "../src/types.ts";

test("normalizeGitUrl unifies ssh/https and strips .git", () => {
  assert.equal(
    normalizeGitUrl("git@gitlab.example.com:group/app.git"),
    "gitlab.example.com/group/app",
  );
  assert.equal(
    normalizeGitUrl("https://gitlab.example.com/group/app"),
    "gitlab.example.com/group/app",
  );
  assert.equal(
    normalizeGitUrl("https://user@gitlab.example.com/group/app.git/"),
    "gitlab.example.com/group/app",
  );
});

test("lookup prefers exact role over any", () => {
  const maps: KsPublishMap[] = [
    createKsPublishMap({
      git_url: "git@h:g/a.git",
      role: "any",
      env_id: "e1",
      namespace: "ns",
      deployment: "any-dep",
    }),
    createKsPublishMap({
      git_url: "git@h:g/a.git",
      role: "backend",
      env_id: "e1",
      namespace: "ns",
      deployment: "api",
    }),
  ];
  const key = normalizeGitUrl("https://h/g/a");
  assert.equal(lookupKsPublishMap(maps, key, "backend")?.deployment, "api");
  assert.equal(lookupKsPublishMap(maps, key, "frontend")?.deployment, "any-dep");
  assert.equal(lookupKsPublishMap(maps, "other", "backend"), null);
});

test("lookupKsPublishMapByDeployment matches env/ns/deploy", () => {
  const maps: KsPublishMap[] = [
    createKsPublishMap({
      git_url: "git@h:g/svc.git",
      role: "backend",
      env_id: "dev",
      namespace: "klcj-zt-dev",
      deployment: "klcj-zt-ad-service",
    }),
  ];
  const hit = lookupKsPublishMapByDeployment(
    maps,
    "dev",
    "klcj-zt-dev",
    "klcj-zt-ad-service",
  );
  assert.equal(hit?.git_url, "git@h:g/svc.git");
  assert.equal(
    lookupKsPublishMapByDeployment(maps, "dev", "klcj-zt-dev", "other"),
    null,
  );
});

test("lookupKsPublishMaps returns all exact-role matches", () => {
  const maps: KsPublishMap[] = [
    createKsPublishMap({
      git_url: "git@h:g/a.git",
      role: "backend",
      env_id: "e1",
      namespace: "ns",
      deployment: "api-a",
    }),
    createKsPublishMap({
      git_url: "git@h:g/a.git",
      role: "backend",
      env_id: "e1",
      namespace: "ns",
      deployment: "api-b",
    }),
    createKsPublishMap({
      git_url: "git@h:g/a.git",
      role: "any",
      env_id: "e1",
      namespace: "ns",
      deployment: "any-dep",
    }),
  ];
  const key = normalizeGitUrl("https://h/g/a");
  const hit = lookupKsPublishMaps(maps, key, "backend").map((m) => m.deployment);
  assert.deepEqual(hit, ["api-a", "api-b"]);
});
