import {
  Autocomplete, Button, Group, Loader, Modal, NumberInput, Select, SimpleGrid,
  Stack, Text, Textarea, TextInput,
} from "@mantine/core";
import { Rocket } from "lucide-react";
import { HEALTH_PATH_OPTIONS } from "./types";
import type { KsDeployMutationsApi } from "./useKsDeployMutations";
import type { KsCmSelectProps } from "./KsCreateDeployModal";

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
        <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
          <TextInput
            label="部署名称"
            description="修改时不可更改"
            value={editForm.name}
            readOnly
            required
          />
          <TextInput
            label="别名（显示名）"
            description="KubeSphere 控制台显示名；默认跟随部署名称，可改"
            placeholder="默认与部署名称相同"
            value={editForm.alias}
            onChange={(e) => setEditForm({ ...editForm, alias: e.currentTarget.value })}
          />
        </SimpleGrid>
        <TextInput
          label="镜像地址"
          placeholder="dockerhub.kubekey.local/tksy-admin/my-service:v1.0.0"
          value={editForm.image}
          onChange={(e) => setEditForm({ ...editForm, image: e.currentTarget.value })}
          required
          data-autofocus
        />
        <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
          <NumberInput
            label="容器端口"
            description="写入 containerPort，并作为三探针探测端口"
            value={editForm.port}
            onChange={(v) => setEditForm({ ...editForm, port: typeof v === "number" ? v : 8080 })}
            min={1}
            max={65535}
            required
          />
          <NumberInput
            label="副本数"
            description="Deployment spec.replicas"
            value={editForm.replicas}
            onChange={(v) => setEditForm({ ...editForm, replicas: typeof v === "number" ? v : 1 })}
            min={0}
            max={100}
          />
        </SimpleGrid>
        <Autocomplete
          label="健康检查路径"
          description="写入 liveness / readiness / startup 三探针；可下拉选择或手动输入"
          placeholder="/actuator/health"
          data={[...HEALTH_PATH_OPTIONS]}
          filter={({ options }) => options}
          value={editForm.healthPath}
          onChange={(v) => setEditForm({ ...editForm, healthPath: v })}
          required
        />
        <Select
          label="引用配置字典"
          description="对齐 KubeSphere：读取该 ConfigMap 全部 key，逐项生成 env.valueFrom.configMapKeyRef"
          placeholder={cmSelectPlaceholder}
          data={cms.map((item) => ({
            value: item.name,
            label: item.alias ? `${item.name}（${item.alias} · ${item.dataSize} keys）` : `${item.name}（${item.dataSize} keys）`,
          }))}
          value={editForm.configMap}
          onChange={(v) => setEditForm({ ...editForm, configMap: v })}
          searchable
          clearable
          disabled={!cmLoading && cms.length === 0}
          rightSection={cmLoading ? <Loader size={16} /> : undefined}
          nothingFoundMessage="无匹配配置字典"
        />
        <Textarea
          label="环境变量（可选，K=V 每行一个，可与配置字典叠加）"
          placeholder={"TZ=Asia/Shanghai\nSPRING_DATA_REDIS_SENTINEL_MASTER=mymaster"}
          value={editForm.envs}
          onChange={(e) => setEditForm({ ...editForm, envs: e.currentTarget.value })}
          minRows={4}
          autosize
          maxRows={12}
          styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
          spellCheck={false}
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
              <Button size="xs" variant="default" onClick={() => void copyText(editPreviewYaml)}>
                📋 复制
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
