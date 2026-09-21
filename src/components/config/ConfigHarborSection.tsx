import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { GripVertical, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { HarborConfig, HarborEnv } from "../../types";
import { isTauriRuntime } from "../../types";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import type { ConfigFieldChange } from "./types";
import { panelPaperProps, sectionCardStyle } from "./configUi";

interface ConfigHarborSectionProps {
  config: HarborConfig;
  showPassword: boolean;
  onConfigChange: ConfigFieldChange;
  onTogglePassword: () => void;
  /** 增删环境后立刻落盘，避免未点「保存」时新环境随关窗丢失（与 KsSection 一致） */
  onSaveConfig: () => void;
}

/** 三个推送面板的记忆位；删除环境后若指向已不存在的 id 需一并修正 */
const HARBOR_LAST_FIELDS = [
  "last_harbor_upload",
  "last_harbor_branch",
  "last_harbor_push",
] as const;

/** 生成唯一环境 id：同毫秒内连续新增时追加序号，避免与已有环境撞号 */
function nextHarborEnvId(existing: HarborEnv[]): string {
  const base = `harbor-${Date.now()}`;
  if (!existing.some((env) => env.id === base)) return base;
  let seq = 2;
  while (existing.some((env) => env.id === `${base}-${seq}`)) seq += 1;
  return `${base}-${seq}`;
}

/** 新增环境的空白草稿（地址/账号/项目留空，由弹窗填） */
function createHarborEnv(existing: HarborEnv[]): HarborEnv {
  return {
    id: nextHarborEnvId(existing),
    name: `环境${existing.length + 1}`,
    url: "",
    username: "",
    password: "",
    project: "",
  };
}

interface HarborProjectsResult {
  names: string[];
  insecure: boolean;
}

export function ConfigHarborSection({
  config,
  showPassword,
  onConfigChange,
  onTogglePassword,
  onSaveConfig,
}: ConfigHarborSectionProps) {
  const { confirm } = useConfirmDialog();
  /** 环境编辑弹窗：add 新增 / edit 编辑 */
  const [envEditor, setEnvEditor] = useState<{ mode: "add" | "edit"; draft: HarborEnv } | null>(null);
  const [envEditorPassword, setEnvEditorPassword] = useState(false);
  /** 正在测试连接的环境 id；null 表示没有在测 */
  const [harborLoginTestingId, setHarborLoginTestingId] = useState<string | null>(null);
  const [harborLoginMsg, setHarborLoginMsg] = useState<
    { envId: string; type: "ok" | "err"; text: string } | null
  >(null);
  /** 项目下拉：拉取中 / 已拉取的项目列表 + 是否自签证书 / 拉取失败 */
  const [projectsState, setProjectsState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; names: string[]; insecure: boolean }
    | { status: "err"; message: string }
  >({ status: "idle" });

  const harborEnvs = config.harbors ?? [];

  // 拖拽排序 sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = harborEnvs.findIndex((env) => env.id === active.id);
    const newIndex = harborEnvs.findIndex((env) => env.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(harborEnvs, oldIndex, newIndex);
    setHarborEnvs(reordered);
    // 拖拽完立刻落盘（与增删一致）
    void onSaveConfig();
  };

  /**
   * 环境的增删改统一走这里：写回 harbors 后顺带修正三个记忆位，
   * 避免留下指向已删除环境的悬空 id（与后端 migrate_harbors 的兜底语义一致）。
   */
  const setHarborEnvs = (next: HarborEnv[]) => {
    onConfigChange("harbors", next);
    if (next.length === 0) {
      for (const field of HARBOR_LAST_FIELDS) onConfigChange(field, "");
      return;
    }
    const ids = new Set(next.map((env) => env.id));
    for (const field of HARBOR_LAST_FIELDS) {
      const remembered = config[field];
      if (remembered && !ids.has(remembered)) onConfigChange(field, next[0].id);
    }
  };

  const openAddHarborEnv = () => {
    setEnvEditorPassword(false);
    setProjectsState({ status: "idle" });
    setEnvEditor({ mode: "add", draft: createHarborEnv(harborEnvs) });
  };

  const openEditHarborEnv = (env: HarborEnv) => {
    setEnvEditorPassword(false);
    setProjectsState({ status: "idle" });
    setEnvEditor({ mode: "edit", draft: { ...env } });
  };

  const closeHarborEnvEditor = () => {
    setEnvEditor(null);
    setEnvEditorPassword(false);
    setProjectsState({ status: "idle" });
  };

  const saveHarborEnvEditor = () => {
    if (!envEditor) return;
    const draft: HarborEnv = {
      ...envEditor.draft,
      name: envEditor.draft.name.trim() || envEditor.draft.name,
      url: envEditor.draft.url.trim(),
      username: envEditor.draft.username.trim(),
      password: envEditor.draft.password ?? "",
      project: envEditor.draft.project.trim(),
    };
    const nextEnvs =
      envEditor.mode === "add"
        ? [...harborEnvs, draft]
        : harborEnvs.map((env) => (env.id === draft.id ? draft : env));
    setHarborEnvs(nextEnvs);
    closeHarborEnvEditor();
    onSaveConfig();
  };

  const removeHarborEnv = async (env: HarborEnv) => {
    const ok = await confirm({
      title: "删除环境",
      message: `确定删除 Harbor 环境「${env.name || env.id}」？推送页将无法再选择该环境。`,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!ok) return;
    setHarborEnvs(harborEnvs.filter((item) => item.id !== env.id));
    onSaveConfig();
    setHarborLoginMsg(null);
  };

  /** 测试连接只读该环境自己的地址/账号，不再读旧的全局字段 */
  const testHarborEnvConnection = async (env: HarborEnv) => {
    if (!isTauriRuntime()) {
      setHarborLoginMsg({ envId: env.id, type: "err", text: "请在桌面端测试连接" });
      return;
    }
    setHarborLoginTestingId(env.id);
    setHarborLoginMsg(null);
    try {
      const msg = await invoke<string>("test_harbor_connection", {
        harborUrl: env.url,
        username: env.username,
        password: env.password,
      });
      setHarborLoginMsg({ envId: env.id, type: "ok", text: msg });
    } catch (e) {
      setHarborLoginMsg({ envId: env.id, type: "err", text: String(e) });
    } finally {
      setHarborLoginTestingId(null);
    }
  };

  /** 拉取 Harbor 项目列表供下拉选择 */
  const fetchHarborProjects = async () => {
    if (!envEditor) return;
    const { url, username, password } = envEditor.draft;
    if (!url.trim() || !username.trim() || !password) {
      setProjectsState({ status: "err", message: "请先填写地址、用户名和密码" });
      return;
    }
    if (!isTauriRuntime()) {
      setProjectsState({ status: "err", message: "请在桌面端拉取项目列表" });
      return;
    }
    setProjectsState({ status: "loading" });
    try {
      const result = await invoke<HarborProjectsResult>("list_harbor_projects", {
        harborUrl: url,
        username,
        password,
      });
      setProjectsState({ status: "ok", names: result.names, insecure: result.insecure });
    } catch (e) {
      setProjectsState({ status: "err", message: String(e) });
    }
  };

  /** 弹窗地址/用户名/密码任一字段变化时重置项目列表状态（待重新拉取） */
  useEffect(() => {
    if (envEditor && projectsState.status !== "idle") {
      setProjectsState({ status: "idle" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envEditor?.draft.url, envEditor?.draft.username, envEditor?.draft.password]);

  return (
    <>
      <Paper {...panelPaperProps}>
        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="nowrap">
            <Text size="sm" c="var(--color-text-muted)">
              可配置多个 Harbor 环境（开发 / 生产等），打包推送时按环境切换
            </Text>
            <Button
              size="xs"
              variant="default"
              leftSection={<Plus size={14} />}
              onClick={openAddHarborEnv}
              style={{ flexShrink: 0 }}
            >
              添加环境
            </Button>
          </Group>

          {harborEnvs.length === 0 && (
            <Text size="sm" c="var(--color-text-muted)">
              还没有环境，点击「添加环境」填写地址、用户名、密码和项目
            </Text>
          )}

          {harborEnvs.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={harborEnvs.map((env) => env.id)}
                strategy={verticalListSortingStrategy}
              >
                <Stack gap="sm">
                  {harborEnvs.map((env) => (
                    <SortableHarborEnvCard
                      key={env.id}
                      env={env}
                      harborLoginTestingId={harborLoginTestingId}
                      harborLoginMsg={harborLoginMsg}
                      onTest={testHarborEnvConnection}
                      onEdit={openEditHarborEnv}
                      onRemove={removeHarborEnv}
                    />
                  ))}
                </Stack>
              </SortableContext>
            </DndContext>
          )}
        </Stack>
      </Paper>

      <Paper {...panelPaperProps} mt="md">
        <Stack gap="md">
          <Text size="sm" fw={600} c="var(--color-text)">
            落地页 / 隐私协议 FTP
          </Text>
          <Text size="xs" c="var(--color-text-muted)">
            账号密码不再写进程序。落地页上传与隐私协议共用用户/密码；隐私主机可单独填写。
          </Text>
          <TextInput
            label="落地页 FTP 主机"
            value={config.landing_ftp_host ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_host", e.currentTarget.value)}
            placeholder="FTP 主机 IP 或域名"
          />
          <TextInput
            label="落地页 FTP 用户"
            value={config.landing_ftp_user ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_user", e.currentTarget.value)}
            placeholder="FTP 用户名"
          />
          <PasswordInput
            label="落地页 FTP 密码"
            value={config.landing_ftp_pass ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_pass", e.currentTarget.value)}
            placeholder="FTP 密码"
            visible={showPassword}
            onVisibilityChange={() => onTogglePassword()}
          />
          <TextInput
            label="落地页站点根目录"
            value={config.landing_ftp_base_dir ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_base_dir", e.currentTarget.value)}
            placeholder="例如: common.example.com（可留空）"
            description="上传后公开 URL 用此主机名拼 https://根目录/渠道/"
          />
          <TextInput
            label="隐私协议 FTP 主机"
            value={config.privacy_ftp_host ?? ""}
            onChange={(e) => onConfigChange("privacy_ftp_host", e.currentTarget.value)}
            placeholder="与落地页不同机时填写"
            description="用户/密码复用上方落地页 FTP 账号"
          />
        </Stack>
      </Paper>

      <Modal
        opened={!!envEditor}
        onClose={closeHarborEnvEditor}
        title={envEditor?.mode === "add" ? "添加 Harbor 环境" : "编辑 Harbor 环境"}
        size="sm"
        styles={{
          content: { background: "var(--color-bg-surface)" },
          header: { background: "var(--color-bg-surface)" },
          title: { color: "var(--color-text)", fontWeight: 600 },
        }}
      >
        {envEditor && (
          <Stack gap="md">
            <TextInput
              label="环境名称"
              value={envEditor.draft.name}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, name: e.currentTarget.value },
              })}
              placeholder="开发 / 生产"
            />
            <TextInput
              label="Harbor 地址"
              value={envEditor.draft.url}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, url: e.currentTarget.value },
              })}
              placeholder="例如: harbor.example.com"
            />
            <TextInput
              label="用户名"
              value={envEditor.draft.username}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, username: e.currentTarget.value },
              })}
              placeholder="Harbor 登录用户名"
            />
            <PasswordInput
              label="密码"
              value={envEditor.draft.password}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, password: e.currentTarget.value },
              })}
              placeholder="Harbor 登录密码"
              visible={envEditorPassword}
              onVisibilityChange={(visible) => setEnvEditorPassword(visible)}
            />
            <Stack gap={4}>
              <Group justify="space-between" align="center">
                <Text size="sm" fw={500} c="var(--color-text)">
                  Harbor 项目
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  loading={projectsState.status === "loading"}
                  disabled={
                    !envEditor.draft.url.trim() ||
                    !envEditor.draft.username.trim() ||
                    !envEditor.draft.password
                  }
                  onClick={() => { void fetchHarborProjects(); }}
                >
                  {projectsState.status === "loading" ? "拉取中..." : "拉取项目列表"}
                </Button>
              </Group>
              {projectsState.status === "ok" && (
                <>
                  <Select
                    data={projectsState.names}
                    value={envEditor.draft.project}
                    onChange={(val) => setEnvEditor({
                      ...envEditor,
                      draft: { ...envEditor.draft, project: val || "" },
                    })}
                    placeholder="从列表选择或手动输入"
                    searchable
                    clearable
                    nothingFoundMessage="无匹配项目"
                  />
                  {projectsState.insecure && (
                    <Text size="xs" c="orange">
                      ⚠️ 该 Harbor 使用自签证书，本次读取跳过了 TLS 校验。建议将 CA 证书放入 ~/.docker/certs.d/{"{"}主机名{"}"}/
                    </Text>
                  )}
                </>
              )}
              {projectsState.status === "err" && (
                <Text size="xs" c="var(--color-error)">
                  {projectsState.message}
                </Text>
              )}
              {projectsState.status === "idle" && (
                <TextInput
                  value={envEditor.draft.project}
                  onChange={(e) => setEnvEditor({
                    ...envEditor,
                    draft: { ...envEditor.draft, project: e.currentTarget.value },
                  })}
                  placeholder="例如: my-project（或点击拉取选择）"
                  description="推送时自动拼在镜像名前，最终地址为 地址/项目名/镜像名:标签"
                />
              )}
            </Stack>
            <Group justify="flex-end" gap="sm" mt="xs">
              <Button variant="default" onClick={closeHarborEnvEditor}>
                取消
              </Button>
              <Button
                variant="filled"
                color="blue"
                disabled={
                  !envEditor.draft.url.trim()
                  || !envEditor.draft.username.trim()
                  || !envEditor.draft.password
                  || !envEditor.draft.project.trim()
                }
                onClick={saveHarborEnvEditor}
              >
                {envEditor.mode === "add" ? "添加" : "保存"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}

interface SortableHarborEnvCardProps {
  env: HarborEnv;
  harborLoginTestingId: string | null;
  harborLoginMsg: { envId: string; type: "ok" | "err"; text: string } | null;
  onTest: (env: HarborEnv) => void;
  onEdit: (env: HarborEnv) => void;
  onRemove: (env: HarborEnv) => void;
}

function SortableHarborEnvCard({
  env,
  harborLoginTestingId,
  harborLoginMsg,
  onTest,
  onEdit,
  onRemove,
}: SortableHarborEnvCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: env.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Paper
      ref={setNodeRef}
      p="sm"
      radius="md"
      withBorder
      style={{ ...sectionCardStyle, ...style }}
    >
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap">
          {/* 拖拽手柄 */}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            style={{ cursor: "grab", touchAction: "none" }}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </ActionIcon>

          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" fw={600} c="var(--color-text)" truncate>
              {env.name || env.id}
            </Text>
            <Text size="xs" c="var(--color-text-muted)" truncate>
              {env.url || "未填地址"}
            </Text>
            <Text size="xs" c="var(--color-text-muted)" truncate>
              {env.username || "未填用户"} · {env.password ? "已设密码" : "未设密码"}
            </Text>
            <Text size="xs" c="var(--color-text-muted)" truncate>
              项目: {env.project || "未填项目"}
            </Text>
          </Stack>

          <Group gap={6} style={{ flexShrink: 0 }}>
            <ActionIcon
              variant="subtle"
              color="gray"
              title="测试连接"
              loading={harborLoginTestingId === env.id}
              onClick={() => onTest(env)}
            >
              <Plug size={14} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="gray"
              title="编辑"
              onClick={() => onEdit(env)}
            >
              <Pencil size={14} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="red"
              title="删除"
              onClick={() => onRemove(env)}
            >
              <Trash2 size={14} />
            </ActionIcon>
          </Group>
        </Group>

        {harborLoginMsg?.envId === env.id && (
          <Text
            size="xs"
            c={harborLoginMsg.type === "ok" ? "var(--color-success)" : "var(--color-error)"}
          >
            {harborLoginMsg.text}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
