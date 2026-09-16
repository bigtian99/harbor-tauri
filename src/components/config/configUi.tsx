import { FolderOpen } from "lucide-react";

export const panelPaperProps = {
  p: "md" as const,
  radius: "md" as const,
  withBorder: true as const,
};

export const sectionCardStyle = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
} as const;

export const browseButtonProps = {
  size: "compact-xs" as const,
  variant: "default" as const,
  leftSection: <FolderOpen size={14} />,
};
