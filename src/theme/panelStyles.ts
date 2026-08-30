/** 运营/构建分区卡片统一外观 */
export const panelPaperStyles = {
  root: {
    background: "var(--color-bg-card)",
    border: "1px solid var(--color-border-strong)",
    boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset",
  },
} as const;

/** 紧凑分段：不要拉满整行 */
export const panelSegmentedStyles = {
  root: {
    width: "fit-content",
    maxWidth: "100%",
    background: "var(--color-bg-base)",
    border: "1px solid var(--color-border-strong)",
    padding: 3,
  },
  indicator: {
    background: "var(--color-primary-muted)",
    boxShadow: "none",
    border: "1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)",
  },
  label: {
    fontWeight: 600,
    fontSize: 13,
    paddingInline: 14,
    color: "var(--color-text-muted)",
    "&[data-active]": { color: "var(--color-primary-hover)" },
  },
  control: {
    minWidth: 96,
  },
} as const;

/** 输入框：比卡片更深一档，避免和 card 糊成一块 */
export const panelFieldStyles = {
  label: { color: "var(--color-text)", fontWeight: 600, marginBottom: 6 },
  description: { color: "var(--color-text-muted)" },
  input: {
    color: "var(--color-text)",
    background: "var(--color-bg-base)",
    backgroundColor: "var(--color-bg-base)",
    border: "1px solid var(--color-border-strong)",
    "&:focus, &:focus-within": {
      borderColor: "var(--color-primary-muted)",
    },
  },
} as const;

/** 主操作按钮：亮蓝底 + 白字（暗色主题常规 CTA） */
export const panelPrimaryButtonStyles = {
  root: {
    background: "var(--color-primary)",
    color: "#fff",
    fontWeight: 700,
    border: "none",
    boxShadow: "0 1px 0 rgba(255,255,255,0.14) inset, 0 8px 20px rgba(59, 158, 255, 0.22)",
    "&:hover:not(:disabled):not([data-disabled])": {
      background: "var(--color-primary-hover)",
      color: "#fff",
    },
    "&:disabled, &[data-disabled]": {
      background: "var(--color-bg-elevated) !important",
      backgroundColor: "var(--color-bg-elevated) !important",
      color: "var(--color-text-muted) !important",
      border: "1px solid var(--color-border-strong) !important",
      boxShadow: "none !important",
      opacity: 0.55,
      cursor: "not-allowed",
    },
  },
  section: {
    color: "inherit",
  },
  label: {
    color: "inherit",
  },
} as const;
