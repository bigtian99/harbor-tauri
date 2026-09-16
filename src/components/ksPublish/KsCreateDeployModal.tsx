import { Button, Group, Modal, Stack, Text, Textarea } from "@mantine/core";
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
  } = deploy;

  return (
    <Modal
      opened={createOpen}
      onClose={() => setCreateOpen(false)}
      title="创建 Deployment"
      size="xl"
      centered
      styles={{ content: { maxHeight: "92vh" }, body: { maxHeight: "84vh", overflow: "auto" } }}
    >
      <Stack className="ks-form-modal">
        <DeployFormFields
          form={createForm}
          setForm={setCreateForm}
          nameEditable
          cms={cms}
          cmLoading={cmLoading}
          cmSelectPlaceholder={cmSelectPlaceholder}
        />
        <Text size="xs" c="dimmed">完整 Deployment（探针/volumes/滚动策略等）由后端模板拼接；部署名已存在会返回 409</Text>
        <Group justify="flex-end">
          <Button size="xs" variant="default" loading={createBusy} onClick={() => void doPreview()}>
            预览 YAML
          </Button>
          <Button size="xs" variant="default" loading={createBusy} onClick={() => void doCreate(true)}>
            校验 (dryRun)
          </Button>
          <Button size="xs" variant="filled" color="blue" loading={createBusy} onClick={() => void doCreate(false)}>
            创建
          </Button>
        </Group>
        {previewYaml && (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="xs" fw={600} c="dimmed">生成的 Deployment YAML</Text>
              <Button size="xs" variant="default" onClick={() => void copyYaml()}>
                📋 复制
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
