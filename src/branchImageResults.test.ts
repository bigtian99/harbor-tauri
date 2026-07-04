import assert from "node:assert/strict";
import { createBranchImageResult, getBranchImageCopyLabel } from "./branchImageResults";

const frontend = createBranchImageResult("frontend", "dockerhub.kubekey.local/proj/app-fe:tag");
const backend = createBranchImageResult("backend", "dockerhub.kubekey.local/proj/app-be:tag");

assert.deepEqual(frontend, {
  role: "frontend",
  label: "前端镜像",
  copyLabel: "复制前端",
  image: "dockerhub.kubekey.local/proj/app-fe:tag",
});

assert.deepEqual(backend, {
  role: "backend",
  label: "后端镜像",
  copyLabel: "复制后端",
  image: "dockerhub.kubekey.local/proj/app-be:tag",
});

assert.equal(getBranchImageCopyLabel("frontend"), "复制前端");
assert.equal(getBranchImageCopyLabel("backend"), "复制后端");
