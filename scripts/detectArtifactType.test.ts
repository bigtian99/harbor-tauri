import assert from "node:assert/strict";
import { detectArtifactTypeFromPath } from "../src/types.ts";

assert.equal(detectArtifactTypeFromPath("/a/b/app.jar"), "jar");
assert.equal(detectArtifactTypeFromPath("C:\\out\\demo.JAR"), "jar");
assert.equal(detectArtifactTypeFromPath("/proj/frontend/dist"), "frontend_dist");
assert.equal(detectArtifactTypeFromPath("/proj/frontend/dist/"), "frontend_dist");
assert.equal(detectArtifactTypeFromPath("/proj/build"), "frontend_dist");
assert.equal(detectArtifactTypeFromPath("/proj/readme.md"), null);

console.log("detectArtifactTypeFromPath OK");
