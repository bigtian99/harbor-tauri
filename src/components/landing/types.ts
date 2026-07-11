import type { SubChannelData, LandingPageResult, FtpUploadResult } from "../../types";
import type { LandingMode } from "../../hooks/useLanding";

export interface LandingPanelProps {
  landingIds: string;
  landingMode: LandingMode;
  vestAuthorization: string;
  landingPreviewData: SubChannelData[];
  landingGenerated: Record<string, LandingPageResult>;
  ftpUploadResults: Record<string, FtpUploadResult>;
  templateIndices: Record<string, number>;
  isFetchingPreview: boolean;
  isGenerating: boolean;
  isUploadingToFtp: boolean;
  progress: number;
  progressMessage: string;
  landingOutputDir: string;
  previewBaseUrl: string;
  setLandingIds: (value: string) => void;
  setLandingMode: (value: LandingMode) => void;
  setVestAuthorization: (value: string) => void;
  setTemplateIndices: (
    value: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)
  ) => void;
  onPreview: () => void;
  onFtpUpload: () => void;
  onCopyAllLinks: () => void;
}

export interface PreviewOverlayState {
  src: string;
  title: string;
}

export interface TemplateGroup {
  category: string;
  dirs: string[];
}
