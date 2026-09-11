import {
  Button, Group, Modal, SegmentedControl, Stack, Text, Textarea, TextInput,
} from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { isRfc1123Name, syncSwAgentNameIfPresent } from "./utils";
import type { KsConfigMapsApi } from "./useKsConfigMaps";

async function copyText(text: string, tip = "已复制到剪贴板") {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notifications.show({ color: "green", message: tip });
  } catch {
    const ta = document.querySelector<HTMLTextAreaElement>(".ks-preview-textarea");
    if (ta) { ta.select(); document.execCommand("copy"); notifications.show({ color: "green", message: "已复制（请 Ctrl+C 确认）" }); }
  }
}

export function KsConfigMapModal(p: KsConfigMapsApi & { namespace: string | null }) {
  return (
    <Modal
      opened={p.cmOpen}
      onClose={() => p.setCmOpen(false)}
      title="创建 ConfigMap"
      size="xl"
      centered
    >
      <Stack gap="sm" className="ks-form-modal">
        <SegmentedControl
          value={p.cmMode}
          onChange={(v) => {
            const next = v as "form" | "yaml";
            p.setCmMode(next);
            p.setCmPreview("");
            // 切到 YAML：表单有内容且 YAML 为空时，自动生成，避免空白编辑器
            if (next === "yaml" && !p.cmYaml.trim() && p.cmForm.name.trim()) {
              void (async () => {
                p.setCmBusy(true);
                try {
                  const yaml = await invoke<string>("ks_preview_configmap", {
                    namespace: p.namespace,
                    name: p.cmForm.name.trim(),
                    data: p.cmForm.data.split("\n").map((l) => l.trim()).filter(Boolean),
                  });
                  p.setCmYaml(yaml);
                } catch (e) {
                  notifications.show({ color: "red", title: "生成 YAML 失败", message: String(e) });
                } finally {
                  p.setCmBusy(false);
                }
              })();
            }
          }}
          data={[{ value: "form", label: "表单（必传项）" }, { value: "yaml", label: "YAML" }]}
          size="xs"
        />
        {p.cmMode === "form" ? (
          <>
            <TextInput
              label="名称"
              description="须小写字母/数字/'-'/'.'（会自动转小写）；若已有 SW_AGENT_NAME 则随名称同步"
              placeholder="my-config"
              value={p.cmForm.name}
              onChange={(e) => {
                const name = e.currentTarget.value.toLowerCase();
                p.setCmForm((prev) => ({
                  name,
                  data: syncSwAgentNameIfPresent(prev.data, name),
                }));
              }}
              error={p.cmForm.name.trim() && !isRfc1123Name(p.cmForm.name) ? "名称不符合 K8s 规范" : undefined}
              required
            />
            <Textarea
              label="键值对（K=V 每行一个）"
              description="仅当已有 SW_AGENT_NAME 时改名称会同步其值；没有则不会自动创建"
              placeholder={"TZ=Asia/Shanghai\nSPRING_PROFILES_ACTIVE=dev"}
              value={p.cmForm.data}
              onChange={(e) => p.setCmForm({ ...p.cmForm, data: e.currentTarget.value })}
              minRows={14}
              autosize
              maxRows={24}
              styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
              spellCheck={false}
            />
            <Group justify="flex-end">
              <Button size="xs" variant="default" loading={p.cmBusy} onClick={() => void p.doCmPreview()}>预览 YAML</Button>
              <Button size="xs" variant="default" loading={p.cmBusy} onClick={() => void p.doCmCreate(true)}>校验 (dryRun)</Button>
              <Button size="xs" variant="filled" color="blue" loading={p.cmBusy} onClick={() => void p.doCmCreate(false)}>创建</Button>
            </Group>
            {p.cmPreview && (
              <Stack>
                <Group justify="space-between">
                  <Text size="xs" fw={600} c="dimmed">生成的 ConfigMap YAML</Text>
                  <Button size="xs" variant="default" onClick={() => void copyText(p.cmPreview)}>📋 复制</Button>
                </Group>
                <Textarea value={p.cmPreview} readOnly minRows={10} autosize maxRows={20} className="ks-preview-textarea" styles={{ input: { fontFamily: "monospace", fontSize: 12 } }} />
              </Stack>
            )}
          </>
        ) : (
          <>
            <Text size="xs" c="dimmed">
              {p.cmBusy ? "正在从表单生成 YAML…" : "编辑完整 ConfigMap YAML（apiVersion: v1 / kind: ConfigMap）"}
            </Text>
            <Textarea
              value={p.cmYaml}
              onChange={(e) => p.setCmYaml(e.currentTarget.value)}
              placeholder={"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: my-config\ndata:\n  KEY: value"}
              minRows={16}
              autosize
              maxRows={28}
              styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
              spellCheck={false}
            />
            <Group justify="flex-end">
              <Button size="xs" variant="default" loading={p.cmBusy} onClick={() => void p.doCmCreate(true)}>校验 (dryRun)</Button>
              <Button size="xs" variant="filled" color="blue" loading={p.cmBusy} onClick={() => void p.doCmCreate(false)}>创建</Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
