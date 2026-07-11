import {
  TextInput,
  Button,
  Group,
  Title,
} from "@mantine/core";
import {
  Globe,
  Rocket,
  ExternalLink,
  Copy,
  Loader2,
  Package,
} from "lucide-react";
import type { LandingMode } from "../../hooks/useLanding";

interface LandingChannelFormProps {
  landingIds: string;
  landingMode: LandingMode;
  vestAuthorization: string;
  isFetchingPreview: boolean;
  isGenerating: boolean;
  isUploadingToFtp: boolean;
  hasGeneratedResults: boolean;
  hasFtpResults: boolean;
  setLandingIds: (value: string) => void;
  setLandingMode: (value: LandingMode) => void;
  setVestAuthorization: (value: string) => void;
  onPreview: () => void;
  onFtpUpload: () => void;
  onCopyAllLinks: () => void;
  onOpenTemplateManager: () => void;
}

export function LandingChannelForm({
  landingIds,
  landingMode,
  vestAuthorization,
  isFetchingPreview,
  isGenerating,
  isUploadingToFtp,
  hasGeneratedResults,
  hasFtpResults,
  setLandingIds,
  setLandingMode,
  setVestAuthorization,
  onPreview,
  onFtpUpload,
  onCopyAllLinks,
  onOpenTemplateManager,
}: LandingChannelFormProps) {
  return (
    <>
      {/* 标题 */}
      <Group gap="xs">
        <Globe size={22} />
        <Title order={3}>生成落地页</Title>
      </Group>

      {/* 模式切换 */}
      <Group gap={0} mb="xs">
        <Button
          size="xs"
          variant="filled"
          style={{
            borderRadius: "6px 0 0 6px",
            background: landingMode === "sub_channel" ? "#5eead4" : "#1a2332",
            color: landingMode === "sub_channel" ? "#0a0f1a" : "#8892b0",
            border: "1px solid #2a3a5c",
            fontWeight: landingMode === "sub_channel" ? 700 : 400,
          }}
          onClick={() => setLandingMode("sub_channel")}
        >
          子渠道
        </Button>
        <Button
          size="xs"
          variant="filled"
          style={{
            borderRadius: "0 6px 6px 0",
            background: landingMode === "vest" ? "#5eead4" : "#1a2332",
            color: landingMode === "vest" ? "#0a0f1a" : "#8892b0",
            border: "1px solid #2a3a5c",
            borderLeft: "none",
            fontWeight: landingMode === "vest" ? 700 : 400,
          }}
          onClick={() => setLandingMode("vest")}
        >
          马甲包
        </Button>
      </Group>

      {/* 马甲包 Authorization */}
      {landingMode === "vest" && (
        <TextInput
          value={vestAuthorization}
          onChange={(e) => setVestAuthorization(e.currentTarget.value)}
          placeholder="Bearer token 或 Authorization 值"
          label="Authorization"
          type="password"
        />
      )}

      {/* IDs */}
      <TextInput
        value={landingIds}
        onChange={(e) => setLandingIds(e.currentTarget.value)}
        placeholder={landingMode === "vest" ? "例如: 512,513" : "例如: 154,155,156"}
        label={landingMode === "vest" ? "马甲包 IDs（逗号分隔）" : "子渠道 IDs（逗号分隔）"}
      />

      {/* 操作按钮 */}
      <Group gap="sm">
        {!hasGeneratedResults && (
          <Button
            leftSection={isFetchingPreview || isGenerating ? <Loader2 size={14} className="spin" /> : <Rocket size={14} />}
            disabled={!landingIds || isFetchingPreview || isGenerating}
            onClick={onPreview}
            variant="gradient"
            gradient={{ from: "teal", to: "cyan" }}
          >
            预览数据
          </Button>
        )}
        {hasGeneratedResults && !isGenerating && (
          <Button
            leftSection={isUploadingToFtp ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}
            disabled={isUploadingToFtp}
            onClick={onFtpUpload}
            color="blue"
          >
            上传到 FTP
          </Button>
        )}
        {hasFtpResults && !isGenerating && (
          <Button
            leftSection={<Copy size={14} />}
            onClick={onCopyAllLinks}
            variant="outline"
            color="gray"
          >
            复制所有链接
          </Button>
        )}
        <Button
          leftSection={<Package size={14} />}
          onClick={onOpenTemplateManager}
          variant="light"
          color="gray"
          style={{ marginLeft: "auto" }}
        >
          管理模板
        </Button>
      </Group>
    </>
  );
}
