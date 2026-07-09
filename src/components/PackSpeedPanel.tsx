import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
            color: "teal",
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
  const numericPriority = Number.parseInt(priority || "0", 10);
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
          <p className="template-hint">自动获取会打开内嵌运营后台登录页；Authorization 仅本次运行内保留，不会写入本地配置。</p>
        </div>

        <div className="form-group">
          <label>类型</label>
          <div className="pack-type-options" role="radiogroup" aria-label="打包加速类型">
            <label className={`pack-type-option ${batchPackType === "subChannel" ? "active" : ""}`}>
              <input
                type="radio"
                name="batch-pack-type"
                value="subChannel"
                checked={batchPackType === "subChannel"}
                onChange={() => setBatchPackType("subChannel")}
              />
              <span>子渠道</span>
            </label>
            <label className={`pack-type-option ${batchPackType === "vest" ? "active" : ""}`}>
              <input
                type="radio"
                name="batch-pack-type"
                value="vest"
                checked={batchPackType === "vest"}
                onChange={() => setBatchPackType("vest")}
              />
              <span>马甲包</span>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label>{idLabel}</label>
          <textarea
            value={idsText}
            onChange={(event) => setIdsText(event.currentTarget.value)}
            placeholder={"10593,10594\n或一行一个 ID"}
          />
          <p className="template-hint">已解析 {ids.length} 个 ID，支持英文逗号、空格、换行分隔。</p>
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
            {isSubmitting ? "提交中..." : getBatchPackSubmitText(batchPackType)}
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
