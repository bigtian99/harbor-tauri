import assert from "node:assert/strict";
import {
  historyCanPushJar,
  historyJarPushTarget,
  resolveHistoryJarPushConfig,
} from "../src/historyJarPush.ts";
import type { BuildRecord, HarborConfig } from "../src/types.ts";

function baseRecord(over: Partial<BuildRecord> = {}): BuildRecord {
  return {
    id: "1",
    timestamp: "",
    repo_path: "/tmp/demo-app",
    branch: "origin/rc-master",
    project_type: "maven",
    artifact_path: "/tmp/demo-app/target/app.jar",
    image_name: null,
    image_tag: null,
    build_command: "mvn",
    package_with_backend: false,
    duration_ms: 1,
    status: "success",
    log_summary: "",
    full_log: "",
    author: "",
    email: "",
    ...over,
  };
}

assert.equal(historyJarPushTarget(baseRecord())?.endsWith("app.jar"), true);
assert.equal(historyCanPushJar(baseRecord({ status: "pushed" })), false);
assert.equal(historyCanPushJar(baseRecord({ project_type: "npm", backend_artifact_path: undefined })), false);
assert.equal(
  historyJarPushTarget(
    baseRecord({
      project_type: "npm",
      artifact_path: "/tmp/dist",
      backend_artifact_path: "/tmp/back.jar",
    }),
  ),
  "/tmp/back.jar",
);

const config = {
  expose_port: "8080",
  remember_branch_settings: false,
  last_spring_profile: "",
  last_expose_port: "",
} as HarborConfig;

const resolved = resolveHistoryJarPushConfig(baseRecord({ image_name: "demo" }), config);
assert.ok(resolved);
assert.equal(resolved!.imageName, "demo-8080");
assert.match(resolved!.imageTag, /^rc-master-v\./);

console.log("historyJarPush.test.ts: ok");
