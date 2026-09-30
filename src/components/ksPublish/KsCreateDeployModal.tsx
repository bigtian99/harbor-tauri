import { Button, Group, Modal, Progress, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import { Copy, Hammer } from "lucide-react";
import { DeployFormFields, type KsCmSelectProps } from "./DeployFormFields";
import type { KsDeployMutationsApi } from "./useKsDeployMutations";

export type { KsCmSelectProps };

export function KsCreateDeployModal({
  deploy,
  cms,
  cmLoading,
  cmSelectPlaceholder,
}: {
  deploy: KsDeployMutationsApi;
  cms: KsCmSelectProps["cms"];
  cmLoading: boolean;
  cmSelectPlaceholder: string;
}) {
  const {
    createOpen, setCreateOpen, createForm, setCreateForm, previewYaml,
    createBusy, doPreview, doCreate, copyYaml,
    createSource, setCreateSource, createGit, setCreateGit, createProgress,
    createGitBranches, createGitBranchesLoading, createGitBranchesError,
    createGitRepoPath, refreshCreateGitBranches,
    createGitModules, createGitModulesLoading,
    createGitDetectedPort, createGitPortLoading,
  } = deploy;

  const gitMode = createSource === "git";
  const building = createProgress.running;
  const busy = createBusy || building;

  return (
    <Modal
      opened={createOpen}
      onClose={() => { if (!busy) setCreateOpen(false); }}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
      title="创建 Deployment"
      size="xl"
      centered
      styles={{ content: { maxHeight: "92vh" }, body: { maxHeight: "84vh", overflow: "auto" } }}
    >
      <Stack className="ks-form-modal">
        <Stack gap={6}>
          <Text size="sm" fw={600}>镜像来源</Text>
          <SegmentedControl
            fullWidth
            size="xs"
            disabled={busy}
            value={createSource}
            onChange={(v) => setCreateSource(v === "git" ? "git" : "image")}
            data={[
              { label: "已有镜像地址", value: "image" },
              { label: "Git 构建镜像", value: "git" },
            ]}
          />
          <Text size="xs" c="dimmed">
            {gitMode
              ? "填 Git 地址与分支，创建时先打包推送镜像，再用产出的镜像创建部署（适合首次、还没有镜像地址的部署）"
              : "直接填写 Harbor 上已有的完整镜像地址"}
          </Text>
        </Stack>

        <DeployFormFields
          form={createForm}
          setForm={setCreateForm}
          nameEditable
          cms={cms}
          cmLoading={cmLoading}
          cmSelectPlaceholder={cmSelectPlaceholder}
          sourceMode={createSource}
          git={createGit}
          setGit={setCreateGit}
          gitBranches={createGitBranches}
          gitBranchesLoading={createGitBranchesLoading}
          gitBranchesError={createGitBranchesError}
          gitRepoPath={createGitRepoPath}
          mavenModules={createGitModules}
          mavenModulesLoading={createGitModulesLoading}
          gitDetectedPort={createGitDetectedPort}
          gitPortLoading={createGitPortLoading}
          onRefreshGitBranches={refreshCreateGitBranches}
        />

        {(building || createProgress.log || createProgress.message) && (
          <Stack gap={6}>
            <Progress
              value={createProgress.percent}
              animated={building}
              size="sm"
              radius="xl"
            />
            <Text size="xs" c={building ? "blue" : "dimmed"}>
              {createProgress.message
                || (building ? "构建中…" : "构建结束")}
              {building ? ` · ${createProgress.percent}%` : ""}
            </Text>
            {createProgress.log && (
              <pre className="ks-deploy-create-log">{createProgress.log}</pre>
            )}
          </Stack>
        )}

        <Text size="xs" c="dimmed">
          完整 Deployment（探针/volumes/滚动策略等）由后端模板拼接；部署名已存在会返回 409
        </Text>
        <Group justify="flex-end">
          {!gitMode && (
            <>
              <Button size="xs" variant="default" loading={busy} onClick={() => void doPreview()}>
                预览 YAML
              </Button>
              <Button size="xs" variant="default" loading={busy} onClick={() => void doCreate(true)}>
                校验 (dryRun)
              </Button>
            </>
          )}
          <Button
            size="xs"
            variant="filled"
            color="blue"
            leftSection={gitMode ? <Hammer size={14} /> : undefined}
            loading={busy}
            onClick={() => void doCreate(false)}
          >
            {gitMode ? "构建并创建" : "创建"}
          </Button>
        </Group>
        {!gitMode && previewYaml && (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="xs" fw={600} c="dimmed">生成的 Deployment YAML</Text>
              <Button size="xs" variant="default" leftSection={<Copy size={13} />} onClick={() => void copyYaml()}>
                复制
              </Button>
            </Group>
            <Textarea
              value={previewYaml}
              readOnly
              minRows={22}
              className="ks-preview-textarea"
              styles={{ input: { fontFamily: "monospace", fontSize: 12, minHeight: "50vh", height: "50vh" } }}
            />
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
