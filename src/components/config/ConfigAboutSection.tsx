import { useState } from "react";
import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import {
  AlertCircle, Bell, CheckCircle, ExternalLink, Loader2, RefreshCw, Trash2,
} from "lucide-react";
import { showSystemAlert } from "../../systemAlert";
import type { HarborConfig } from "../../types";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { openReleasePage } from "../../utils/releasePage";
import { sectionCardStyle } from "./configUi";

export type CheckUpdateResult = {
  status: "update" | "latest" | "error";
  message: string;
};

interface ConfigAboutSectionProps {
  config: HarborConfig;
  appVersion?: string;
  onCheckUpdate?: () => Promise<CheckUpdateResult>;
  onClearGitRecords?: () => Promise<boolean>;
}

export function ConfigAboutSection({
  config,
  appVersion,
  onCheckUpdate,
  onClearGitRecords,
}: ConfigAboutSectionProps) {
  const { confirm } = useConfirmDialog();
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ type: "ok" | "update" | "err"; text: string } | null>(null);
  const [clearingGit, setClearingGit] = useState(false);
  const [gitClearMsg, setGitClearMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const gitRecordCount =
    (config.repo_path_history?.length ?? 0) + Object.keys(config.branch_repo_settings ?? {}).length;
  const hasGitRecords = Boolean(
    gitRecordCount > 0 ||
    config.last_repo_path?.trim() ||
    config.last_branch?.trim() ||
    config.last_frontend_dir?.trim() ||
    config.last_build_script?.trim() ||
    config.last_spring_profile?.trim() ||
    config.last_expose_port?.trim(),
  );

  const handleClearGitRecords = async () => {
    if (!onClearGitRecords || clearingGit) return;
    setClearingGit(true);
    setGitClearMsg(null);
    try {
      const cleared = await onClearGitRecords();
      if (cleared) {
        setGitClearMsg({ type: "ok", text: "已清空 Git 记录" });
      } else {
        setGitClearMsg({ type: "err", text: "清空失败，请稍后重试" });
      }
    } catch (e) {
      setGitClearMsg({ type: "err", text: String(e) });
    } finally {
      setClearingGit(false);
    }
  };

  const handleClearGitClick = async () => {
    if (!onClearGitRecords || !hasGitRecords || clearingGit) return;
    const ok = await confirm({
      title: "清空 Git 记录",
      message: "此操作不可恢复，将清除以下本地记忆：",
      details: [
        "分支打包 / 快捷合并的仓库路径历史",
        "上次选择的仓库与分支",
        "各仓库的高级设置（端口、nginx 等）",
      ],
      confirmLabel: "确认清空",
      variant: "danger",
    });
    if (ok) {
      await handleClearGitRecords();
    }
  };

  const handleCheckUpdate = async () => {
    if (!onCheckUpdate || checking) return;
    setChecking(true);
    setCheckMsg(null);
    try {
      const r = await onCheckUpdate();
      if (r.status === "update") setCheckMsg({ type: "update", text: r.message });
      else if (r.status === "latest") setCheckMsg({ type: "ok", text: r.message });
      else setCheckMsg({ type: "err", text: r.message });
    } catch (e) {
      setCheckMsg({ type: "err", text: String(e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Stack gap="md" className="about-panel">
      <Paper p="lg" radius="md" withBorder style={sectionCardStyle}>
        <Stack gap="sm" align="center">
          <Text size="xl" fw={700} c="var(--color-text)">
            码头工坊
          </Text>
          <Text size="sm" c="var(--color-text-muted)">
            当前版本 <Text span fw={600} c="var(--color-primary)">v{appVersion || "—"}</Text>
          </Text>
          <Text size="sm" c="var(--color-text-muted)">
            JAR / 前端 dist 一键打包推送 Harbor
          </Text>
          <Group gap="sm" mt="xs">
            <Button
              size="sm"
              variant="default"
              leftSection={checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              onClick={() => { void handleCheckUpdate(); }}
              disabled={checking || !onCheckUpdate}
              loading={checking}
            >
              {checking ? "检查中…" : "检查更新"}
            </Button>
            <Button
              size="sm"
              variant="subtle"
              color="gray"
              rightSection={<ExternalLink size={12} />}
              onClick={() => {
                void openReleasePage().catch((e) => {
                  void showSystemAlert("无法打开发布页", String(e));
                });
              }}
            >
              发布页
            </Button>
          </Group>
          {checkMsg && (
            <Group
              gap={8}
              p="sm"
              style={{
                borderRadius: "var(--radius-md)",
                background:
                  checkMsg.type === "ok"
                    ? "rgba(16, 185, 129, 0.12)"
                    : checkMsg.type === "update"
                      ? "var(--color-primary-muted)"
                      : "rgba(239, 68, 68, 0.12)",
                border: `1px solid ${
                  checkMsg.type === "ok"
                    ? "var(--color-success)"
                    : checkMsg.type === "update"
                      ? "var(--color-primary)"
                      : "var(--color-error)"
                }`,
                color:
                  checkMsg.type === "ok"
                    ? "var(--color-success)"
                    : checkMsg.type === "update"
                      ? "var(--color-primary-hover)"
                      : "var(--color-error)",
              }}
            >
              {checkMsg.type === "ok" && <CheckCircle size={14} />}
              {checkMsg.type === "update" && <RefreshCw size={14} />}
              {checkMsg.type === "err" && <AlertCircle size={14} />}
              <Text size="sm">{checkMsg.text}</Text>
            </Group>
          )}
        </Stack>
      </Paper>

      <Paper p="lg" radius="md" withBorder style={sectionCardStyle}>
        <Stack gap="sm">
          <Text size="md" fw={600} c="var(--color-text)">
            Git 本地记录
          </Text>
          <Text size="sm" c="var(--color-text-muted)">
            包含分支打包与快捷合并中的仓库路径历史，以及各仓库的高级设置记忆。
            {gitRecordCount > 0 ? ` 当前共 ${gitRecordCount} 条路径/仓库记忆。` : hasGitRecords ? " 当前有分支选择记忆。" : " 当前暂无记录。"}
          </Text>
          <Button
            size="sm"
            color="red"
            variant="light"
            leftSection={<Trash2 size={16} />}
            onClick={() => void handleClearGitClick()}
            disabled={!onClearGitRecords || !hasGitRecords || clearingGit}
            loading={clearingGit}
            w="fit-content"
          >
            清空 Git 记录
          </Button>
          {gitClearMsg && (
            <Group
              gap={8}
              p="sm"
              style={{
                borderRadius: "var(--radius-md)",
                background: gitClearMsg.type === "ok" ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
                border: `1px solid ${gitClearMsg.type === "ok" ? "var(--color-success)" : "var(--color-error)"}`,
                color: gitClearMsg.type === "ok" ? "var(--color-success)" : "var(--color-error)",
              }}
            >
              {gitClearMsg.type === "ok" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              <Text size="sm">{gitClearMsg.text}</Text>
            </Group>
          )}
        </Stack>
      </Paper>

      <Paper p="lg" radius="md" withBorder style={sectionCardStyle}>
        <Stack gap="sm">
          <Text size="md" fw={600} c="var(--color-text)">
            系统通知测试
          </Text>
          <Text size="sm" c="var(--color-text-muted)">
            点击发送一条测试通知，验证 macOS 通知中心是否正常工作。若无弹出，请前往
            「系统设置 → 通知 → JarPorter」开启允许通知。
          </Text>
          <Button
            size="sm"
            variant="default"
            leftSection={<Bell size={16} />}
            onClick={() => void showSystemAlert("测试通知", "JarPorter 系统通知正常")}
            w="fit-content"
          >
            发送测试通知
          </Button>
        </Stack>
      </Paper>

      <Paper
        p={0}
        radius="md"
        className="config-tip"
        styles={{
          root: {
            background:
              "linear-gradient(135deg, var(--color-primary-muted), rgba(56, 189, 248, 0.05))",
            border: "1px solid var(--color-primary-muted)",
            boxShadow: "0 4px 16px var(--color-primary-muted)",
          },
        }}
      >
        <Group gap={6} align="center" wrap="nowrap" mb="xs">
          <AlertCircle size={14} style={{ display: "block", flexShrink: 0 }} />
          <Text size="sm" fw={600} lh={1.3} c="var(--color-text)">
            配置说明
          </Text>
        </Group>
        <Stack gap={6} component="ul" className="config-tip-list">
          {[
            "配置保存后无需重复填写",
            "Harbor 地址不需要带 https:// 前缀",
            "Harbor 项目为仓库中的项目名，会与镜像名称拼接",
            "JAR 模式使用 JAR 基础镜像和 JAR 暴露端口",
            "前端 dist 模式会把所选 dist 目录的内容复制为 nginx 站点根目录，不会在镜像里嵌套 dist 目录",
            "默认 nginx.conf 的 /index.html 回退路径对应 /usr/share/nginx/html/index.html",
          ].map((item) => (
            <Text key={item} component="li" size="xs" lh={1.5} c="var(--color-text-muted)">
              {item}
            </Text>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
