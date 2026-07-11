import type { SubChannelData, LandingPageResult, FtpUploadResult } from "../../types";
import type { LandingMode } from "../../hooks/useLanding";
import { ChannelPreviewTable } from "./ChannelPreviewTable";
import { VestPreviewTable } from "./VestPreviewTable";

interface LandingPreviewProps {
  landingMode: LandingMode;
  landingPreviewData: SubChannelData[];
  landingGenerated: Record<string, LandingPageResult>;
  ftpUploadResults: Record<string, FtpUploadResult>;
  templateIndices: Record<string, number>;
  animatingCards: Record<string, string>;
  landingOutputDir: string;
  previewBaseUrl: string;
  onSwitchTemplate: (id: string, direction: "prev" | "next") => void;
  onOpenPreview: (src: string, title: string) => void;
}

export function LandingPreview({
  landingMode,
  landingPreviewData,
  landingGenerated,
  ftpUploadResults,
  templateIndices,
  animatingCards,
  landingOutputDir,
  previewBaseUrl,
  onSwitchTemplate,
  onOpenPreview,
}: LandingPreviewProps) {
  return (
    <>
      <ChannelPreviewTable
        landingPreviewData={landingPreviewData}
        landingGenerated={landingGenerated}
        ftpUploadResults={ftpUploadResults}
        templateIndices={templateIndices}
        animatingCards={animatingCards}
        landingOutputDir={landingOutputDir}
        previewBaseUrl={previewBaseUrl}
        onSwitchTemplate={onSwitchTemplate}
        onOpenPreview={onOpenPreview}
      />

      {landingMode === "vest" && (
        <VestPreviewTable
          landingGenerated={landingGenerated}
          ftpUploadResults={ftpUploadResults}
          templateIndices={templateIndices}
          animatingCards={animatingCards}
          landingOutputDir={landingOutputDir}
          previewBaseUrl={previewBaseUrl}
          onSwitchTemplate={onSwitchTemplate}
          onOpenPreview={onOpenPreview}
        />
      )}
    </>
  );
}
