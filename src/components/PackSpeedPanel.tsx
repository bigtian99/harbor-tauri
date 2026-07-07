import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { AlertTriangle, CheckCircle, KeyRound, Loader2, Rocket } from "lucide-react";

import { isBatchPackUnauthorized, parseSubChannelIds } from "../opsBatchPack";
import { isTauriRuntime } from "../types";
import type { BatchPackResult } from "../types";

interface PackSpeedPanelProps {
  authorization: string;
  onAuthorizationChange: (value: string) => void;
  onSaveAuthorization: (value: string) => Promise<void>;
}

export function PackSpeedPanel({
  authorization,
  onAuthorizationChange,
  onSaveAuthorization,
}: PackSpeedPanelProps) {
  const [localAuthorization, setLocalAuthorization] = useState(authorization);
  const [idsText, setIdsText] = useState("");
  const [priority, setPriority] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<BatchPackResult | null>(null);

  useEffect(() => {
    setLocalAuthorization(authorization);
  }, [authorization]);

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
          <p className="template-hint">点击提交时会自动保存到本地配置；接口返回 401 时需要重新获取 token。</p>
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
