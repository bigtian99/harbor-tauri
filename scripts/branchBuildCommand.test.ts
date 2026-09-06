import assert from "node:assert/strict";
import {
  computeDefaultBuildCommand,
  isDefaultPackBuildCommand,
  parseMavenProfileFromCommand,
  parseNpmScriptFromCommand,
  resetPackBuildCommand,
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

assert.deepEqual(
  resetPackBuildCommand({ projectType: "maven" }),
  {
    springProfile: "prod",
    buildScript: "",
    command:
      "mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=prod",
  },
);

assert.deepEqual(
  resetPackBuildCommand({ projectType: "npm", packageManager: "pnpm" }),
  {
    springProfile: "",
    buildScript: "build",
    command: "pnpm install && pnpm run build",
  },
);

assert.deepEqual(
  resetPackBuildCommand({
    projectType: "npm",
    packageManager: "npm",
    packageWithBackend: true,
  }),
  {
    springProfile: "",
    buildScript: "build",
    command:
      "npm install && npm run build && mvn clean package -Dmaven.test.skip=true",
  },
);

assert.equal(
  isDefaultPackBuildCommand(
    "mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=prod",
    { projectType: "maven" },
  ),
  true,
);
assert.equal(
  isDefaultPackBuildCommand(
    "mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=test",
    { projectType: "maven" },
  ),
  false,
);

console.log("branchBuildCommand.test.ts OK");
