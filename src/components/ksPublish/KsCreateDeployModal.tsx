import {
  Autocomplete, Button, Group, Loader, Modal, NumberInput, Select, SimpleGrid,
  Stack, Text, Textarea, TextInput,
} from "@mantine/core";
import { HEALTH_PATH_OPTIONS } from "./types";
import { isRfc1123Name } from "./utils";
import type { KsDeployMutationsApi } from "./useKsDeployMutations";

export type KsCmSelectProps = {
  cms: { name: string; alias: string; dataSize: number }[];
  cmLoading: boolean;
  cmSelectPlaceholder: string;
};

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
        <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
          <TextInput
            label="部署名称"
            description="须小写字母/数字/'-'/'.'（会自动转小写）"
            placeholder="klcj-test-service"
            value={createForm.name}
            onChange={(e) => {
              const name = e.currentTarget.value.toLowerCase();
              setCreateForm((prev) => ({
                ...prev,
                name,
                // 别名未手改（空或仍等于旧部署名）时跟随；后端空别名也会落成部署名
                alias: !prev.alias.trim() || prev.alias === prev.name ? name : prev.alias,
              }));
            }}
            error={createForm.name.trim() && !isRfc1123Name(createForm.name) ? "名称不符合 K8s 规范" : undefined}
            required
          />
          <TextInput
            label="别名（显示名）"
            description="KubeSphere 控制台显示名；默认跟随部署名称，可改"
            placeholder="默认与部署名称相同"
            value={createForm.alias}
            onChange={(e) => setCreateForm({ ...createForm, alias: e.currentTarget.value })}
          />
        </SimpleGrid>
        <TextInput
          label="镜像地址"
          placeholder="dockerhub.kubekey.local/tksy-admin/my-service:v1.0.0"
          value={createForm.image}
          onChange={(e) => setCreateForm({ ...createForm, image: e.currentTarget.value })}
          required
        />
        <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
          <NumberInput
            label="容器端口"
            description="写入 containerPort，并作为三探针探测端口"
            value={createForm.port}
            onChange={(v) => setCreateForm({ ...createForm, port: typeof v === "number" ? v : 8080 })}
            min={1}
            max={65535}
            required
          />
          <NumberInput
            label="副本数"
            description="Deployment spec.replicas"
            value={createForm.replicas}
            onChange={(v) => setCreateForm({ ...createForm, replicas: typeof v === "number" ? v : 1 })}
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
          value={createForm.healthPath}
          onChange={(v) => setCreateForm({ ...createForm, healthPath: v })}
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
          value={createForm.configMap}
          onChange={(v) => setCreateForm({ ...createForm, configMap: v })}
          searchable
          clearable
          disabled={!cmLoading && cms.length === 0}
          rightSection={cmLoading ? <Loader size={16} /> : undefined}
          nothingFoundMessage="无匹配配置字典"
        />
        <Textarea
          label="环境变量（可选，K=V 每行一个，可与配置字典叠加）"
          placeholder={"TZ=Asia/Shanghai\nSPRING_DATA_REDIS_SENTINEL_MASTER=mymaster"}
          value={createForm.envs}
          onChange={(e) => setCreateForm({ ...createForm, envs: e.currentTarget.value })}
          minRows={4}
          autosize
          maxRows={12}
          styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
          spellCheck={false}
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
