import {
  createBranchImageResult,
  getBranchImageCopyLabel,
  getBranchPushSummary,
  shouldShowBranchProgress,
  shouldShowBranchResults,
} from "../src/branchImageResults";

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

assertEqual(
  getBranchPushSummary([
    "❌ 前端推送失败: docker build失败",
    "📦 后端: ✅ 镜像推送成功!",
  ], true),
  "⚠️ 前端推送失败，但后端推送成功",
  "frontend failure should not hide a successful backend push",
);

assertEqual(
  getBranchPushSummary([
    "📦 前端: ✅ 镜像推送成功!",
    "❌ 后端推送失败: docker build失败",
  ], true),
  "⚠️ 前端推送成功，但后端推送失败",
  "backend failure should keep frontend success visible",
);

assertEqual(
  getBranchPushSummary([
    "❌ 前端推送失败: docker build失败",
    "❌ 后端推送失败: docker build失败",
  ], true),
  "❌ 前端和后端镜像推送失败",
  "both push failures should be called out explicitly",
);

assertEqual(
  shouldShowBranchResults(true, "/tmp/dist"),
  false,
  "branch result links should stay hidden while package or push is still running",
);

assertEqual(
  shouldShowBranchResults(false, "/tmp/dist"),
  true,
  "branch result links should show after package and push are no longer running",
);

assertEqual(
  shouldShowBranchProgress(true, "", 10),
  true,
  "progress should show while branch build is running",
);

assertEqual(
  shouldShowBranchProgress(false, "❌ docker build失败", 25),
  true,
  "progress should remain visible after a failed push stops before 100 percent",
);

assertEqual(
  shouldShowBranchProgress(false, "✅ 分支打包并推送镜像完成", 100),
  false,
  "progress should hide after a completed 100 percent success",
);
