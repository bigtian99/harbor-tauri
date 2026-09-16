import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { FolderOpen } from "lucide-react";
import type { HarborConfig } from "../../types";
import { isTauriRuntime } from "../../types";
import {
  deriveMavenLocalRepo,
  isDerivedMavenLocalRepo,
} from "../../utils/mavenPaths";
import type { ConfigFieldChange } from "./types";
import { browseButtonProps, panelPaperProps } from "./configUi";

interface ConfigJarSectionProps {
  config: HarborConfig;
  onConfigChange: ConfigFieldChange;
}

export function ConfigJarSection({ config, onConfigChange }: ConfigJarSectionProps) {
  const [mavenProbe, setMavenProbe] = useState<{
    source: string;
    effective_home: string;
    effective_local_repo: string;
    bundled_available: boolean;
    bundled_home: string;
    bundled_java_home: string;
    home_valid: boolean;
  } | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke<{
      source: string;
      effective_home: string;
      effective_local_repo: string;
      bundled_available: boolean;
      bundled_home: string;
      bundled_java_home: string;
      home_valid: boolean;
    }>("resolve_maven_settings", { config })
      .then(setMavenProbe)
      .catch(() => setMavenProbe(null));
  }, [config.maven_home, config.maven_local_repo]);

  const applyMavenHome = (home: string) => {
    const nextHome = home.trim();
    const currentRepo = (config.maven_local_repo ?? "").trim();
    const currentHome = (config.maven_home ?? "").trim();
    onConfigChange("maven_home", nextHome);
    if (
      nextHome
      && isDerivedMavenLocalRepo(currentHome, currentRepo)
    ) {
      onConfigChange("maven_local_repo", deriveMavenLocalRepo(nextHome));
    }
  };

  return (
    <Paper {...panelPaperProps}>
      <Stack gap="md">
        <TextInput
          label="JAR 基础镜像"
          value={config.base_image}
          onChange={(e) => onConfigChange("base_image", e.currentTarget.value)}
          placeholder="例如: eclipse-temurin:17-jre"
        />
        <TextInput
          label="JAR 暴露端口"
          value={config.expose_port}
          onChange={(e) => onConfigChange("expose_port", e.currentTarget.value)}
          placeholder="例如: 8181"
        />
        <TextInput
          label={
            <Group gap={6}>
              <FolderOpen size={14} />
              <span>Maven Home</span>
            </Group>
          }
          value={config.maven_home ?? ""}
          onChange={(e) => applyMavenHome(e.currentTarget.value)}
          placeholder="留空则尝试环境变量 MAVEN_HOME / M2_HOME"
          description="本机需已安装 Maven（及 JDK）。优先读配置，其次环境变量。填写后会自动带上 conf/settings.xml"
          rightSectionWidth={90}
          rightSection={
            <Button
              {...browseButtonProps}
              onClick={async () => {
                if (!isTauriRuntime()) return;
                try {
                  const current = (config.maven_home ?? "").trim();
                  const selected = await open({
                    multiple: false,
                    directory: true,
                    recursive: false,
                    title: "选择 Maven 安装目录",
                    defaultPath: current || undefined,
                  });
                  if (selected) applyMavenHome(selected as string);
                } catch (e) {
                  console.error("选择 Maven Home 失败:", e);
                }
              }}
            >
              选择
            </Button>
          }
        />
        {mavenProbe && (
          <Text size="xs" c={mavenProbe.home_valid ? "var(--color-success)" : "var(--color-text-muted)"}>
            {mavenProbe.home_valid ? (
              <>
                当前生效（{mavenProbe.source === "bundled" ? "安装包内置" : mavenProbe.source}
                ）：{mavenProbe.effective_home}
                {mavenProbe.effective_local_repo ? ` · 仓库 ${mavenProbe.effective_local_repo}` : ""}
              </>
            ) : mavenProbe.bundled_available ? (
              <>检测到可选内置 Maven/JDK（{mavenProbe.bundled_home}），留空配置时可使用</>
            ) : (
              <>未检测到有效 Maven；请安装本机 Maven/JDK，或在上方填写 Maven Home</>
            )}
          </Text>
        )}
        <TextInput
          label={
            <Group gap={6}>
              <FolderOpen size={14} />
              <span>Maven 本地仓库</span>
            </Group>
          }
          value={config.maven_local_repo ?? ""}
          onChange={(e) => onConfigChange("maven_local_repo", e.currentTarget.value)}
          placeholder="默认 ~/.m2/repository 或 {Maven Home}/repository"
          description='手动指定 Home 时默认 {"{home}/repository"}；也可单独修改本地仓库路径'
          rightSectionWidth={90}
          rightSection={
            <Button
              {...browseButtonProps}
              onClick={async () => {
                if (!isTauriRuntime()) return;
                try {
                  const current = (config.maven_local_repo ?? "").trim();
                  const home = (config.maven_home ?? "").trim();
                  const selected = await open({
                    multiple: false,
                    directory: true,
                    recursive: false,
                    title: "选择 Maven 本地仓库目录",
                    defaultPath: current || home || undefined,
                  });
                  if (selected) onConfigChange("maven_local_repo", selected as string);
                } catch (e) {
                  console.error("选择 Maven 本地仓库失败:", e);
                }
              }}
            >
              选择
            </Button>
          }
        />
        <TextInput
          label={
            <Group gap={6}>
              <FolderOpen size={14} />
              <span>tools 目录 (--build-context)</span>
            </Group>
          }
          value={config.custom_docker_extras_dir}
          onChange={(e) => onConfigChange("custom_docker_extras_dir", e.currentTarget.value)}
          placeholder="例如: /Users/daijunxiong/code/packingmachine/tools"
          description={
            <>
              填 tools/ 的绝对路径，jarporter 通过 <code>--build-context tools=</code> 注入。Dockerfile 里用{" "}
              <code>COPY --from=tools ./ /opt/tools/</code> 获取。
            </>
          }
          rightSectionWidth={90}
          rightSection={
            <Button
              {...browseButtonProps}
              onClick={async () => {
                if (!isTauriRuntime()) return;
                try {
                  const selected = await open({
                    multiple: false,
                    directory: true,
                    recursive: false,
                    title: "选择 tools 目录",
                  });
                  if (selected) {
                    onConfigChange("custom_docker_extras_dir", selected as string);
                  }
                } catch (e) {
                  console.error("选择目录失败:", e);
                }
              }}
            >
              选择
            </Button>
          }
        />
      </Stack>
    </Paper>
  );
}
