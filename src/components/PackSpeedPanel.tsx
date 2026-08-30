import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { AlertTriangle, CheckCircle, KeyRound, Loader2, LogIn, Rocket } from "lucide-react";

import {
  getBatchPackIdLabel,
  getBatchPackSubmitText,
  isBatchPackUnauthorized,
  parseSubChannelIds,
} from "../opsBatchPack";
import { isTauriRuntime } from "../types";
import type { BatchPackResult } from "../types";
import type { BatchPackType } from "../opsBatchPack";

import { panelPaperStyles, panelPrimaryButtonStyles, panelSegmentedStyles, panelFieldStyles } from "../theme/panelStyles";
import "../styles/ops-panel.css";

interface PackSpeedPanelProps {
  authorization: string;
  onAuthorizationChange: (value: string) => void;
  onSaveAuthorization: (value: string) => Promise<void>;
}

interface OpsAuthTokenCapturedPayload {
  token?: string;
  ids?: string[];
  packType?: BatchPackType;
}

const fieldStyles = panelFieldStyles;

export function PackSpeedPanel({
  authorization,
  onAuthorizationChange,
  onSaveAuthorization,
}: PackSpeedPanelProps) {
  const onAuthorizationChangeRef = useRef(onAuthorizationChange);
  const onSaveAuthorizationRef = useRef(onSaveAuthorization);
  const [localAuthorization, setLocalAuthorization] = useState(authorization);
  const [batchPackType, setBatchPackType] = useState<BatchPackType>("subChannel");
  const [idsText, setIdsText] = useState("");
  const [priority, setPriority] = useState<number | string>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpeningLogin, setIsOpeningLogin] = useState(false);
  const [result, setResult] = useState<BatchPackResult | null>(null);

  useEffect(() => {
    onAuthorizationChangeRef.current = onAuthorizationChange;
    onSaveAuthorizationRef.current = onSaveAuthorization;
  }, [onAuthorizationChange, onSaveAuthorization]);

  useEffect(() => {
    setLocalAuthorization(authorization);
  }, [authorization]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen<OpsAuthTokenCapturedPayload>("ops-auth-token-captured", async (event) => {
        const token = event.payload.token?.trim();
        if (!token) {
          return;
        }

        const syncedIds = Array.isArray(event.payload.ids)
          ? parseSubChannelIds(event.payload.ids.join("\n"))
          : [];
        if (syncedIds.length > 0) {
          setIdsText(syncedIds.join("\n"));
        }
        if (event.payload.packType === "subChannel" || event.payload.packType === "vest") {
          setBatchPackType(event.payload.packType);
        }

        setLocalAuthorization(token);
        onAuthorizationChangeRef.current(token);
        try {
          await onSaveAuthorizationRef.current(token);
          await invoke("close_ops_login_window").catch(() => {});
          notifications.show({
            title: "Authorization 已获取",
            message: syncedIds.length > 0
              ? `登录 token 已获取，并同步 ${syncedIds.length} 个${getBatchPackIdLabel(event.payload.packType || batchPackType)}`
              : "登录 token 已在本次运行中可用",
            color: "cyan",
            autoClose: 3000,
          });
        } catch (e) {
          notifications.show({
            title: "处理 token 失败",
            message: String(e),
            color: "red",
            autoClose: 6000,
          });
        }
      })
      .then((handler) => {
        if (disposed) {
          handler();
        } else {
          unlisten = handler;
        }
      })
      .catch((e) => {
        notifications.show({
          title: "监听登录 token 失败",
          message: String(e),
          color: "red",
          autoClose: 6000,
        });
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function handleOpenLogin() {
    if (!isTauriRuntime()) {
      notifications.show({
        title: "无法打开登录窗口",
        message: "请在 Tauri 桌面窗口中使用自动获取",
        color: "yellow",
        autoClose: 4000,
      });
      return;
    }

    setIsOpeningLogin(true);
    try {
      await invoke("open_ops_login_window");
    } catch (e) {
      notifications.show({
        title: "打开登录窗口失败",
        message: String(e),
        color: "red",
        autoClose: 6000,
      });
    } finally {
      setIsOpeningLogin(false);
    }
  }

  const ids = parseSubChannelIds(idsText);
  const numericPriority = typeof priority === "number" ? priority : Number.parseInt(String(priority || "0"), 10);
  const idLabel = getBatchPackIdLabel(batchPackType);
  const canSubmit =
    localAuthorization.trim() &&
    ids.length > 0 &&
    Number.isFinite(numericPriority) &&
    !isSubmitting;

  async function handleSubmit() {
    if (!isTauriRuntime()) {
      notifications.show({
        title: "无法调用接口",
        message: "请在 Tauri 桌面窗口中使用打包加速",
        color: "yellow",
        autoClose: 4000,
      });
      return;
    }
    if (!localAuthorization.trim()) {
      notifications.show({
        title: "缺少 Authorization",
        message: "请输入 Authorization 后再提交",
        color: "yellow",
        autoClose: 3500,
      });
      return;
    }
    if (ids.length === 0) {
      notifications.show({
        title: `缺少${idLabel}`,
        message: `请输入至少一个${idLabel}`,
        color: "yellow",
        autoClose: 3500,
      });
      return;
    }

    setIsSubmitting(true);
    setResult(null);
    try {
      await onSaveAuthorization(localAuthorization);
      const response = await invoke<BatchPackResult>("batch_pack_sub_channels", {
        authorization: localAuthorization.trim(),
        ids,
        packType: batchPackType,
        priority: numericPriority,
      });
      setResult(response);
      if (isBatchPackUnauthorized(response)) {
        notifications.show({
          title: "Authorization 已失效",
          message: "接口返回 401，请重新获取 token 后重试",
          color: "red",
          autoClose: 7000,
        });
        return;
      }
      if (response.code === 200) {
        notifications.show({
          message: response.message || "打包加速已提交",
          color: "cyan",
          autoClose: 3000,
        });
      } else {
        notifications.show({
          title: `接口返回 ${response.code}`,
          message: response.message || "打包加速提交失败",
          color: "yellow",
          autoClose: 6000,
        });
      }
    } catch (e) {
      notifications.show({
        title: "打包加速失败",
        message: String(e),
        color: "red",
        autoClose: 6000,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const resultColor = result
    ? isBatchPackUnauthorized(result) || result.code !== 200
      ? "yellow"
      : "cyan"
    : "cyan";

  return (
    <Stack gap="md" className="pack-speed-panel">
      <Paper p="md" radius="md" styles={panelPaperStyles}>
        <Stack gap="md">
          <PasswordInput
            label={
              <Group gap={6}>
                <KeyRound size={14} />
                <span>Authorization</span>
              </Group>
            }
            value={localAuthorization}
            onChange={(event) => {
              setLocalAuthorization(event.currentTarget.value);
              onAuthorizationChange(event.currentTarget.value);
            }}
            placeholder="输入运营后台 Authorization token"
            autoComplete="off"
            rightSectionWidth={120}
            rightSection={
              <Button
                variant="default"
                size="xs"
                onClick={handleOpenLogin}
                disabled={isOpeningLogin}
                leftSection={
                  isOpeningLogin
                    ? <Loader2 size={14} className="spin" />
                    : <LogIn size={14} />
                }
                className="ops-btn-secondary"
                style={{ marginRight: 4 }}
              >
                自动获取
              </Button>
            }
            styles={fieldStyles}
            description="自动获取会打开内嵌运营后台登录页；Authorization 仅本次运行内保留，不会写入本地配置。"
          />

          <Stack gap={6}>
            <Text size="sm" fw={600} c="var(--color-text)">类型</Text>
            <SegmentedControl
              value={batchPackType}
              onChange={(value) => setBatchPackType(value as BatchPackType)}
              data={[
                { label: "子渠道", value: "subChannel" },
                { label: "马甲包", value: "vest" },
              ]}
              styles={panelSegmentedStyles}
            />
          </Stack>

          <Textarea
            label={idLabel}
            value={idsText}
            onChange={(event) => setIdsText(event.currentTarget.value)}
            placeholder={"10593,10594\n或一行一个 ID"}
            minRows={4}
            styles={{
              ...fieldStyles,
              input: {
                ...fieldStyles.input,
                fontFamily: 'var(--mantine-font-family-monospace)',
              },
            }}
            description={`已解析 ${ids.length} 个 ID，支持英文逗号、空格、换行分隔。`}
          />

          <NumberInput
            label="优先级"
            value={priority}
            onChange={setPriority}
            step={1}
            allowNegative
            placeholder="0"
            styles={fieldStyles}
          />

          <Button
            variant="filled"
            color="blue"
            fullWidth
            size="md"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={isSubmitting}
            leftSection={!isSubmitting ? <Rocket size={18} /> : undefined}
            styles={panelPrimaryButtonStyles}
            className="pack-speed-submit"
          >
            {isSubmitting ? "提交中..." : getBatchPackSubmitText(batchPackType)}
          </Button>

          {result && (
            <Alert
              variant="light"
              color={resultColor}
              icon={
                result.code === 200 && !isBatchPackUnauthorized(result)
                  ? <CheckCircle size={18} />
                  : <AlertTriangle size={18} />
              }
              title={String(result.code)}
            >
              {result.message || "无返回消息"}
            </Alert>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
