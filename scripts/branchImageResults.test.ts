import { createBranchImageResult, getBranchImageCopyLabel } from "../src/branchImageResults";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
  }
}

const frontend = createBranchImageResult("frontend", "dockerhub.kubekey.local/proj/app-fe:tag");
const backend = createBranchImageResult("backend", "dockerhub.kubekey.local/proj/app-be:tag");

assertJsonEqual(frontend, {
  role: "frontend",
  label: "前端镜像",
  copyLabel: "复制前端",
  image: "dockerhub.kubekey.local/proj/app-fe:tag",
}, "frontend image result should keep a pure image value and frontend copy label");

assertJsonEqual(backend, {
  role: "backend",
  label: "后端镜像",
  copyLabel: "复制后端",
  image: "dockerhub.kubekey.local/proj/app-be:tag",
}, "backend image result should keep a pure image value and backend copy label");

assertEqual(getBranchImageCopyLabel("frontend"), "复制前端", "frontend copy label");
assertEqual(getBranchImageCopyLabel("backend"), "复制后端", "backend copy label");
