import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGitUrl,
  lookupKsPublishMap,
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
