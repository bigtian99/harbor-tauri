import { Button, Group, Loader, Modal, Stack, Text, Textarea } from "@mantine/core";
import { Copy, Rocket } from "lucide-react";
import { DeployFormFields, type KsCmSelectProps } from "./DeployFormFields";
import type { KsDeployMutationsApi } from "./useKsDeployMutations";

export function KsEditDeployModal({
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
    editOpen, setEditOpen, editLoading, editForm, setEditForm,
    editPreviewYaml, setEditPreviewYaml, submitting,
    doEditPreview, submit, copyText,
  } = deploy;

  return (
    <Modal
      opened={editOpen}
      onClose={() => { setEditOpen(false); setEditPreviewYaml(""); }}
      title={editForm.name ? `修改 Deployment · ${editForm.name}` : "修改 Deployment"}
      size="xl"
      centered
      styles={{ content: { maxHeight: "92vh" }, body: { maxHeight: "84vh", overflow: "auto" } }}
    >
      <Stack className="ks-form-modal">
        {editLoading && (
          <Group gap={8}>
            <Loader size={14} />
            <Text size="xs" c="dimmed">正在读取部署详情…</Text>
          </Group>
        )}
        <DeployFormFields
          form={editForm}
          setForm={setEditForm}
          nameEditable={false}
          cms={cms}
          cmLoading={cmLoading}
          cmSelectPlaceholder={cmSelectPlaceholder}
          imageAutoFocus
        />
        <Text size="xs" c="dimmed">提交后将 merge-patch 更新 Deployment（镜像/端口/副本/探针/环境变量/别名），并触发滚动发布</Text>
        <Group justify="flex-end">
          <Button size="xs" variant="default" loading={submitting || editLoading} onClick={() => void doEditPreview()}>
            预览 YAML
          </Button>
          <Button size="xs" variant="default" onClick={() => { setEditOpen(false); setEditPreviewYaml(""); }} disabled={submitting}>
            取消
          </Button>
          <Button
            size="xs"
            variant="filled"
            color="blue"
            leftSection={<Rocket size={14} />}
            loading={submitting || editLoading}
            onClick={() => void submit()}
          >
            提交变更
          </Button>
        </Group>
        {editPreviewYaml && (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="xs" fw={600} c="dimmed">预览 Deployment YAML（模板结构）</Text>
              <Button size="xs" variant="default" leftSection={<Copy size={13} />} onClick={() => void copyText(editPreviewYaml)}>
                复制
              </Button>
            </Group>
            <Textarea
              value={editPreviewYaml}
              readOnly
              minRows={16}
              className="ks-preview-textarea"
              styles={{ input: { fontFamily: "monospace", fontSize: 12, minHeight: "40vh", height: "40vh" } }}
            />
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
