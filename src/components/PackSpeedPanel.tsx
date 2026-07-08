import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import { AlertTriangle, CheckCircle, KeyRound, Loader2, LogIn, Rocket } from "lucide-react";

import { isBatchPackUnauthorized, parseSubChannelIds } from "../opsBatchPack";
import { isTauriRuntime } from "../types";
import type { BatchPackResult } from "../types";

interface PackSpeedPanelProps {
  authorization: string;
  onAuthorizationChange: (value: string) => void;
  onSaveAuthorization: (value: string) => Promise<void>;
}

interface OpsAuthTokenCapturedPayload {
  token?: string;
  subChannelIds?: string[];
}

export function PackSpeedPanel({
  authorization,
  onAuthorizationChange,
  onSaveAuthorization,
}: PackSpeedPanelProps) {
  const onAuthorizationChangeRef = useRef(onAuthorizationChange);
  const onSaveAuthorizationRef = useRef(onSaveAuthorization);
  const [localAuthorization, setLocalAuthorization] = useState(authorization);
  const [idsText, setIdsText] = useState("");
  const [priority, setPriority] = useState("0");
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

        const syncedSubChannelIds = Array.isArray(event.payload.subChannelIds)
          ? parseSubChannelIds(event.payload.subChannelIds.join("\n"))
          : [];
        if (syncedSubChannelIds.length > 0) {
          setIdsText(syncedSubChannelIds.join("\n"));
        }

        setLocalAuthorization(token);
        onAuthorizationChangeRef.current(token);
        try {
          await onSaveAuthorizationRef.current(token);
          await invoke("close_ops_login_window").catch(() => {});
          notifications.show({
            title: "Authorization 已获取",
            message: syncedSubChannelIds.length > 0
              ? `登录 token 已保存，并同步 ${syncedSubChannelIds.length} 个子渠道 ID`
              : "登录 token 已自动保存",
            color: "teal",
            autoClose: 3000,
          });
        } catch (e) {
          notifications.show({
            title: "保存 token 失败",
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

  const subChannelIds = parseSubChannelIds(idsText);
  const numericPriority = Number.parseInt(priority || "0", 10);
  const canSubmit =
    localAuthorization.trim() &&
    subChannelIds.length > 0 &&
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
    if (subChannelIds.length === 0) {
      notifications.show({
        title: "缺少子渠道 ID",
        message: "请输入至少一个子渠道 ID",
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
        subChannelIds,
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
          color: "teal",
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

  return (
    <div className="branch-panel pack-speed-panel">
      <div className="branch-card">
        <div className="form-group">
          <label><KeyRound size={14} /> Authorization</label>
          <div className="auth-input-row">
            <input
              type="password"
              value={localAuthorization}
              onChange={(event) => {
                setLocalAuthorization(event.currentTarget.value);
                onAuthorizationChange(event.currentTarget.value);
              }}
              placeholder="输入运营后台 Authorization token"
              autoComplete="off"
            />
            <button
              type="button"
              className="secondary-action-btn auth-login-btn"
              onClick={handleOpenLogin}
              disabled={isOpeningLogin}
            >
              {isOpeningLogin ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
              自动获取
            </button>
          </div>
          <p className="template-hint">自动获取会打开内嵌运营后台登录页；点击提交时会自动保存到本地配置。</p>
        </div>

        <div className="form-group">
          <label>子渠道 ID</label>
          <textarea
            value={idsText}
            onChange={(event) => setIdsText(event.currentTarget.value)}
            placeholder={"10593,10594\n或一行一个 ID"}
          />
          <p className="template-hint">已解析 {subChannelIds.length} 个 ID，支持英文逗号、空格、换行分隔。</p>
        </div>

        <div className="form-group">
          <label>优先级</label>
          <input
            type="number"
            value={priority}
            onChange={(event) => setPriority(event.currentTarget.value)}
            min={0}
            step={1}
            placeholder="0"
          />
        </div>

        <div className="pack-speed-actions">
          <button
            type="button"
            className="build-btn"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSubmitting ? <Loader2 size={18} className="spin" /> : <Rocket size={18} />}
            {isSubmitting ? "提交中..." : "提交打包加速"}
          </button>
        </div>

        {result && (
          <div className={`pack-speed-result ${isBatchPackUnauthorized(result) ? "warning" : result.code === 200 ? "success" : "warning"}`}>
            {result.code === 200 ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <div>
              <strong>{result.code}</strong>
              <span>{result.message || "无返回消息"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
