import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestKlcjZtByGitUrl,
  suggestKlcjZtByRepoPath,
  suggestKlcjZtGit,
  resolveKlcjZtExposePort,
} from "../src/utils/klcjZtGitDefaults.ts";

test("suggests backend git and port for service deployments", () => {
  const hit = suggestKlcjZtGit("klcj-zt-comic-service");
  assert.equal(hit?.role, "backend");
  assert.equal(hit?.git_url, "https://gitee.com/cstksy/klcj-zt-comic-service.git");
  assert.equal(hit?.expose_port, "9613");
});

test("maps user-service typo dir to real origin and port", () => {
  const a = suggestKlcjZtGit("klcj-zt-user-service");
  const b = suggestKlcjZtGit("klcj--zt-user-service");
  assert.equal(a?.git_url, "https://gitee.com/cstksy/klcj--zt-user-service.git");
  assert.equal(b?.git_url, a?.git_url);
  assert.equal(a?.expose_port, "9611");
});

test("maps common-service aliases to ztcommon git and port", () => {
  assert.equal(
    suggestKlcjZtGit("klcj-zt-common-service")?.git_url,
    "https://gitee.com/cstksy/klcj-ztcommon-service.git",
  );
  assert.equal(suggestKlcjZtGit("klcj-ztcommon-service")?.expose_port, "9610");
});

test("maps dist-service to distribution git and port", () => {
  assert.equal(
    suggestKlcjZtGit("klcj-zt-dist-service")?.git_url,
    "https://gitee.com/cstksy/klcj-zt-distribution-service.git",
  );
  assert.equal(suggestKlcjZtGit("klcj-zt-dist-service")?.expose_port, "9621");
});

test("admin is frontend with nginx port 80", () => {
  const hit = suggestKlcjZtGit("klcj-zt-admin");
  assert.equal(hit?.role, "frontend");
  assert.equal(hit?.git_url, "https://gitee.com/cstksy/klcj-zt-admin.git");
  assert.equal(hit?.expose_port, "80");
});

test("cli gateway/system share git but different ports", () => {
  const git = "https://gitee.com/cstksy/kunlunchuangjie-cli.git";
  assert.equal(suggestKlcjZtGit("ruoyi-gateway")?.git_url, git);
  assert.equal(suggestKlcjZtGit("ruoyi-gateway")?.expose_port, "8080");
  assert.equal(suggestKlcjZtGit("klcj-zt-system-service")?.git_url, git);
  assert.equal(suggestKlcjZtGit("klcj-zt-system-service")?.expose_port, "9201");
});

test("repo path and git url lookups carry ports", () => {
  assert.equal(
    suggestKlcjZtByRepoPath("/Users/x/klcj-zt-comic-service")?.expose_port,
    "9613",
  );
  assert.equal(
    suggestKlcjZtByGitUrl("https://gitee.com/cstksy/klcj-zt-finance-service.git")
      ?.expose_port,
    "9616",
  );
});

test("resolveKlcjZtExposePort prefers existing then deployment", () => {
  assert.equal(
    resolveKlcjZtExposePort({ deployment: "klcj-zt-comic-service", existingPort: "1" }),
    "1",
  );
  assert.equal(
    resolveKlcjZtExposePort({ deployment: "klcj-zt-comic-service" }),
    "9613",
  );
});

test("unknown deployment has no default", () => {
  assert.equal(suggestKlcjZtGit("nginx"), null);
  assert.equal(suggestKlcjZtGit(""), null);
});
