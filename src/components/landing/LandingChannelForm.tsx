import {
  TextInput,
  Button,
  Group,
  Paper,
  Stack,
  SegmentedControl,
} from "@mantine/core";
import {
  Rocket,
  ExternalLink,
  Copy,
  Loader2,
  Package,
} from "lucide-react";
import type { LandingMode } from "../../hooks/useLanding";
import { panelSegmentedStyles } from "../../theme/panelStyles";

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
      <Group justify="flex-end" align="flex-end" wrap="wrap" gap="sm">
        <Button
          leftSection={<Package size={14} />}
          onClick={onOpenTemplateManager}
          variant="default"
          size="sm"
          className="ops-btn-secondary"
        >
          管理模板
        </Button>
      </Group>

      <Paper p="lg" radius="md">
        <Stack gap="md">
          <SegmentedControl
            size="sm"
            value={landingMode}
            onChange={(v) => setLandingMode(v as LandingMode)}
            data={[
              { value: "sub_channel", label: "子渠道" },
              { value: "vest", label: "马甲包" },
            ]}
            styles={panelSegmentedStyles}
          />

          {landingMode === "vest" && (
            <TextInput
              value={vestAuthorization}
              onChange={(e) => setVestAuthorization(e.currentTarget.value)}
              placeholder="Bearer token 或 Authorization 值"
              label="Authorization"
              type="password"
            />
          )}

          <TextInput
            value={landingIds}
            onChange={(e) => setLandingIds(e.currentTarget.value)}
            placeholder={landingMode === "vest" ? "例如: 512,513" : "例如: 154,155,156"}
            label={landingMode === "vest" ? "马甲包 IDs（逗号分隔）" : "子渠道 IDs（逗号分隔）"}
          />

          <Group gap="sm" mt={4}>
            {!hasGeneratedResults && (
              <Button
                leftSection={
                  isFetchingPreview || isGenerating ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Rocket size={14} />
                  )
                }
                disabled={!landingIds || isFetchingPreview || isGenerating}
                onClick={onPreview}
                variant="filled"
                color="blue"
              >
                预览数据
              </Button>
            )}
            {hasGeneratedResults && !isGenerating && (
              <Button
                leftSection={
                  isUploadingToFtp ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />
                }
                disabled={isUploadingToFtp}
                onClick={onFtpUpload}
                variant="filled"
                color="blue"
                className="build-cta"
              >
                上传到 FTP
              </Button>
            )}
            {hasFtpResults && !isGenerating && (
              <Button
                leftSection={<Copy size={14} />}
                onClick={onCopyAllLinks}
                variant="default"
                className="ops-btn-secondary"
              >
                复制所有链接
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>
    </>
  );
}
