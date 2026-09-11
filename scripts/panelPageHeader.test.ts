/**
 * 主面板页头：与上传推送同款 eyebrow / title / sub。
 * 跑法：pnpm test（scripts/*.test.ts）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

assert.match(read("src/App.css"), /panel-header\.css/, "App.css 应引入 panel-header.css");
assert.match(read("src/styles/panel-header.css"), /\.panel-eyebrow/, "应有眉标样式");
assert.match(read("src/styles/panel-header.css"), /\.panel-title/, "应有标题样式");
assert.match(read("src/components/PanelPageHeader.tsx"), /export function PanelPageHeader/, "应有共用页头组件");

const panels: Array<{ file: string; title: string; eyebrow: string }> = [
  { file: "src/components/UploadPanel.tsx", title: "上传推送", eyebrow: "JAR / DIST → DOCKER → HARBOR" },
  { file: "src/components/BranchPanel.tsx", title: "分支打包", eyebrow: "GIT BRANCH → BUILD → HARBOR" },
  { file: "src/components/PushImagePanel.tsx", title: "镜像推送", eyebrow: "LOCAL IMAGE → TAG → HARBOR" },
  { file: "src/components/MergePanel.tsx", title: "分支合并", eyebrow: "SOURCE → TARGET → MERGE" },
  { file: "src/components/HistoryPanel.tsx", title: "历史记录", eyebrow: "BUILD HISTORY → REPUSH" },
  { file: "src/components/landing/LandingChannelForm.tsx", title: "生成落地页", eyebrow: "CHANNEL → TEMPLATE → FTP" },
  { file: "src/components/PrivacyPanel.tsx", title: "隐私协议", eyebrow: "TEMPLATE → PREVIEW → FTP" },
  { file: "src/components/SettlementPanel.tsx", title: "结算单", eyebrow: "CHANNEL TABLE → SETTLEMENT → XLSX" },
  { file: "src/components/PackSpeedPanel.tsx", title: "打包加速", eyebrow: "OPS BATCH → PACK QUEUE" },
  { file: "src/components/KsPublishPanel.tsx", title: "KubeSphere 发布", eyebrow: "HARBOR IMAGE → KUBESPHERE" },
  { file: "src/components/ConfigPanel.tsx", title: "设置", eyebrow: "HARBOR · BAOTA · KUBESPHERE" },
  { file: "src/components/BtJavaProjectsPanel.tsx", title: "Java 项目", eyebrow: "JAR → BAOTA JAVA" },
  { file: "src/components/BtPhpSitesPanel.tsx", title: "PHP 项目", eyebrow: "DIST → BAOTA PHP" },
];

for (const p of panels) {
  const src = read(p.file);
  assert.match(src, /PanelPageHeader/, `${p.file} 应使用 PanelPageHeader`);
  assert.match(src, new RegExp(`title="${p.title}"`), `${p.file} 标题应为 ${p.title}`);
  assert.match(
    src,
    new RegExp(`eyebrow="${p.eyebrow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    `${p.file} 眉标应为 ${p.eyebrow}`,
  );
}

console.log("panelPageHeader.test.ts: ok");
