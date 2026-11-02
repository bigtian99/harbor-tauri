import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Group, NumberInput, Paper, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Copy, ExternalLink, Power, RefreshCw, SquareStack } from "lucide-react";
import { isTauriRuntime } from "../../types";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { panelPaperProps } from "./configUi";

interface NgrokTunnel {
  port: number;
  publicUrl: string;
  /** true=本应用起的隧道（可停止）；false=复用了外部 ngrok 的隧道 */
  owned: boolean;
}

interface NgrokInfo {
  installed: boolean;
  path: string;
  version: string;
}

const PORT_STORAGE_KEY = "jarporter.ngrok-port";
const DEFAULT_PORT = 8080;

/** 上次成功映射的端口（跨重启记忆）；无记录或非法值回落到 8080 */
function loadRememberedPort(): number {
  try {
    const n = Number(localStorage.getItem(PORT_STORAGE_KEY));
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  } catch {
    /* 读不到就用默认 */
  }
  return DEFAULT_PORT;
}

function rememberPort(p: number) {
  try {
    localStorage.setItem(PORT_STORAGE_KEY, String(p));
  } catch {
    /* 配额满等忽略 */
  }
}

/** 输入框改端口时即时记忆（只记合法整数；空串/半截输入不覆盖上次值） */
function onPortChange(next: number | string, setPort: (v: number | string) => void) {
  setPort(next);
  const n = Number(next);
  if (Number.isInteger(n) && n >= 1 && n <= 65535) rememberPort(n);
}

/**
 * 端口映射（ngrok）：输入本地端口 → 起一条公网隧道。
 * 复用本机已安装的 ngrok；不使用内置二进制。
 */
export function ConfigNgrokSection() {
  const [info, setInfo] = useState<NgrokInfo | null>(null);
  const [tunnel, setTunnel] = useState<NgrokTunnel | null>(null);
  const [port, setPort] = useState<number | string>(loadRememberedPort);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(0);
  const { confirm } = useConfirmDialog();

  // 本机 ngrok 进程数（含外部启动的）：0 时禁用「停止全部映射」；每 5 秒刷新
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const tick = () => {
      void invoke<number>("ngrok_running").then(setRunning).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  // 启动期间显示已等待秒数（ngrok 自身握手就要 10–15 秒，给个「在动」的反馈）
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const [i, t, n] = await Promise.all([
        invoke<NgrokInfo>("ngrok_info"),
        invoke<NgrokTunnel | null>("ngrok_status"),
        invoke<number>("ngrok_running"),
      ]);
      setInfo(i);
      setTunnel(t);
      setRunning(n);
      if (t) {
        setPort(t.port);
        rememberPort(t.port);
      }
      setError((prev) => (t ? "" : prev));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = async () => {
    const p = Number(port);
    if (!Number.isFinite(p) || p < 1 || p > 65535) {
      notifications.show({ color: "yellow", message: "请填写有效端口（1–65535）" });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const t = await invoke<NgrokTunnel>("ngrok_start", { port: p });
      setTunnel(t);
      setPort(p);
      rememberPort(p);
      void refresh();
      notifications.show({ color: "green", title: "端口已映射", message: t.publicUrl, autoClose: 6000 });
    } catch (e) {
      setError(String(e));
      notifications.show({ color: "red", title: "映射失败", message: String(e), autoClose: 10000 });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await invoke<boolean>("ngrok_stop");
      setTunnel(null);
      setError("");
      void refresh();
      notifications.show({ color: "gray", message: "已停止映射" });
    } catch (e) {
      notifications.show({ color: "red", title: "停止失败", message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  /** 停止全部：本应用起的 + 外部启动的 ngrok 进程 */
  const stopAll = async () => {
    const ok = await confirm({
      title: "停止全部 ngrok 映射",
      message: "将停止本应用起的隧道，并结束本机所有外部启动的 ngrok 进程。",
      details: ["外部 ngrok（例如别的工具或你手动起的）也会被一并停掉"],
      confirmLabel: "全部停止",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await invoke<{ killed: number; remaining: number }>("ngrok_stop_all");
      setTunnel(null);
      setError("");
      // 用后端返回值校准（不再用旧计数推算，避免「按钮说 1、点击说没有」的矛盾）
      setRunning(r.remaining);
      void refresh();
      notifications.show({
        color: r.killed > 0 ? "gray" : r.remaining > 0 ? "orange" : "blue",
        message: r.killed > 0
          ? `已停止 ${r.killed} 个 ngrok 进程`
          : r.remaining > 0
            ? `仍有 ${r.remaining} 个 ngrok 未能停止，请手动检查`
            : "当前没有运行中的 ngrok",
      });
    } catch (e) {
      notifications.show({ color: "red", title: "停止全部失败", message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!tunnel) return;
    try {
      await navigator.clipboard.writeText(tunnel.publicUrl);
      notifications.show({ color: "blue", message: "已复制公网地址", autoClose: 2000 });
    } catch (e) {
      notifications.show({ color: "red", message: `复制失败：${e}` });
    }
  };

  const openUrl = async () => {
    if (!tunnel) return;
    try {
      await invoke("open_external_url", { url: tunnel.publicUrl });
    } catch (e) {
      notifications.show({ color: "red", message: String(e) });
    }
  };

  const installed = info?.installed ?? false;

  return (
    <Paper {...panelPaperProps}>
      <Stack gap="md">
        <Stack gap={4}>
          <Group gap={6}>
            <Power size={14} />
            <Text fw={600}>端口映射（ngrok）</Text>
          </Group>
          <Text size="xs" c="var(--color-text-muted)">
            填一个本机端口（如 KubeSphere 预览、临时服务），用本机已安装的 ngrok 起一条公网隧道。
            凭证走本机 ngrok 配置（<code>ngrok config add-authtoken</code>）。
          </Text>
          <Text size="xs" c="orange">
            ⚠️ 映射成功后该端口在公网可直接访问，仅用于临时联调，用完请及时停止。
          </Text>
        </Stack>

        {!installed && info !== null && (
          <Text size="xs" c="orange" style={{ whiteSpace: "pre-wrap" }}>
            未检测到 ngrok。请先安装后重启应用：
            {"\n"}macOS：<code>brew install --cask ngrok</code>
            {"\n"}Windows：到 ngrok.com 下载 ngrok.exe 并加入 PATH
          </Text>
        )}

        {installed && (
          <Text size="xs" c="var(--color-text-muted)">
            已检测到 ngrok：{info?.version || info?.path}
            {running > 0 ? ` · 当前运行中 ${running} 个进程` : " · 当前没有运行中的进程"}
          </Text>
        )}

        <Group align="flex-end" gap="sm" wrap="wrap">
          <NumberInput
            label="本地端口"
            min={1}
            max={65535}
            w={160}
            value={port}
            onChange={(v) => onPortChange(v, setPort)}
            disabled={busy || !!tunnel}
          />
          {tunnel ? (
            tunnel.owned ? (
              <Button
                variant="light"
                color="red"
                loading={busy}
                leftSection={<Power size={14} />}
                onClick={() => void stop()}
              >
                停止映射
              </Button>
            ) : null
          ) : (
            <Button
              variant="filled"
              color="blue"
              loading={busy}
              disabled={!installed}
              leftSection={<Power size={14} />}
              onClick={() => void start()}
            >
              开始映射
            </Button>
          )}
          {(!tunnel || !tunnel.owned) && (
            <Button
              variant="default"
              loading={busy}
              leftSection={<RefreshCw size={14} />}
              onClick={() => void refresh()}
            >
              刷新状态
            </Button>
          )}
          <Button
            variant="light"
            color="red"
            disabled={busy || running === 0}
            leftSection={<SquareStack size={14} />}
            title={running === 0 ? "当前没有运行中的 ngrok" : `停止 ${running} 个 ngrok 进程`}
            onClick={() => void stopAll()}
          >
            停止全部映射{running > 0 ? ` (${running})` : ""}
          </Button>
        </Group>

        {busy && (
          <Text size="xs" c="var(--color-text-muted)">
            正在连接 ngrok…已等待 {elapsed}s（ngrok 自身握手通常 10–15 秒，网络不佳会更久）
          </Text>
        )}

        {tunnel && (
          <Stack gap={6}>
            <TextInput
              label="公网地址"
              value={tunnel.publicUrl}
              readOnly
              rightSectionWidth={72}
              rightSection={
                <Button size="compact-xs" variant="subtle" color="gray" onClick={() => void copyUrl()}>
                  <Copy size={13} />
                </Button>
              }
            />
            <Group gap="sm">
              <Button
                size="xs"
                variant="default"
                leftSection={<ExternalLink size={13} />}
                onClick={() => void openUrl()}
              >
                打开
              </Button>
              <Text size="xs" c="var(--color-text-muted)">
                指向本机 127.0.0.1:{tunnel.port}
              </Text>
            </Group>
            {!tunnel.owned && (
              <Text size="xs" c="var(--color-text-muted)">
                该端口的隧道由外部 ngrok 提供（免费账号同时只能一个会话），本应用无法停止它。
              </Text>
            )}
          </Stack>
        )}

        {error && (
          <Text size="xs" c="red" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
