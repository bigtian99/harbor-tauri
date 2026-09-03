import assert from "node:assert/strict";
import {
  computeDefaultBuildCommand,
  parseMavenProfileFromCommand,
  parseNpmScriptFromCommand,
} from "../src/branchBuildCommand.ts";

assert.equal(
  computeDefaultBuildCommand({
    projectType: "npm",
    packageManager: "npm",
    buildScript: "build:prod",
  }),
  "npm install && npm run build:prod",
);

assert.equal(
  computeDefaultBuildCommand({
    projectType: "npm",
    packageManager: "pnpm",
    buildScript: "build",
    packageWithBackend: true,
  }),
  "pnpm install && pnpm run build && mvn clean package -Dmaven.test.skip=true",
);

assert.equal(
  computeDefaultBuildCommand({
    projectType: "maven",
    springProfile: "prod",
  }),
  "mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=prod",
);

assert.equal(parseNpmScriptFromCommand("build:prod"), "build:prod");
assert.equal(parseNpmScriptFromCommand("npm"), null);
assert.equal(
  parseNpmScriptFromCommand("npm install && npm run build:test"),
  "build:test",
);
assert.equal(parseNpmScriptFromCommand("pnpm run build:dev"), "build:dev");
assert.equal(
  parseMavenProfileFromCommand(
    "mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=prod",
  ),
  "prod",
);

console.log("branchBuildCommand.test.ts OK");
