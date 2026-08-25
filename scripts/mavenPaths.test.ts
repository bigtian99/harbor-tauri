import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveMavenLocalRepo,
  isDerivedMavenLocalRepo,
} from "../src/utils/mavenPaths.ts";

test("deriveMavenLocalRepo appends repository", () => {
  assert.equal(
    deriveMavenLocalRepo("/Users/daijunxiong/app/apache-maven-3.9.9"),
    "/Users/daijunxiong/app/apache-maven-3.9.9/repository",
  );
  assert.equal(
    deriveMavenLocalRepo("/Users/daijunxiong/app/apache-maven-3.9.9/"),
    "/Users/daijunxiong/app/apache-maven-3.9.9/repository",
  );
  assert.equal(deriveMavenLocalRepo(""), "");
});

test("isDerivedMavenLocalRepo detects auto-filled path", () => {
  assert.equal(
    isDerivedMavenLocalRepo(
      "/opt/maven",
      "/opt/maven/repository",
    ),
    true,
  );
  assert.equal(isDerivedMavenLocalRepo("/opt/maven", ""), true);
  assert.equal(
    isDerivedMavenLocalRepo("/opt/maven", "/custom/repo"),
    false,
  );
});
