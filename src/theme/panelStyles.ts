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

/** 主操作按钮：沉蓝实心底，避免冰蓝在暗面上发飘 */
export const panelPrimaryButtonStyles = {
  root: {
    background: "var(--color-primary-solid)",
    color: "#f8fbff",
    fontWeight: 650,
    border: "1px solid color-mix(in srgb, var(--color-primary-hover) 28%, transparent)",
    boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset, 0 6px 16px rgba(13, 40, 80, 0.28)",
    "&:hover:not(:disabled):not([data-disabled])": {
      background: "var(--color-primary-solid-hover)",
      color: "#fff",
      borderColor: "color-mix(in srgb, var(--color-primary-hover) 40%, transparent)",
    },
    "&:disabled, &[data-disabled]": {
      background: "color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-elevated)) !important",
      backgroundColor: "color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-elevated)) !important",
      color: "color-mix(in srgb, var(--color-primary-hover) 70%, var(--color-text-muted)) !important",
      border: "1px dashed color-mix(in srgb, var(--color-primary) 45%, var(--color-border-strong)) !important",
      boxShadow: "none !important",
      opacity: 0.72,
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

/** 次要强调：翠绿描边（复制/克隆等，与主蓝 CTA 区分） */
export const panelAccentButtonStyles = {
  root: {
    background: "transparent",
    border: "1px solid color-mix(in srgb, var(--color-success) 55%, transparent)",
    color: "var(--color-success)",
    fontWeight: 600,
    "&:hover:not(:disabled):not([data-disabled])": {
      background: "var(--color-success-muted)",
      borderColor: "var(--color-success)",
      color: "#6ee7b7",
    },
    "&:disabled, &[data-disabled]": {
      background: "transparent !important",
      border: "1px dashed color-mix(in srgb, var(--color-success) 35%, var(--color-border-strong)) !important",
      color: "color-mix(in srgb, var(--color-success) 55%, var(--color-text-muted)) !important",
      boxShadow: "none !important",
      opacity: 0.68,
      cursor: "not-allowed",
    },
  },
  section: { color: "inherit" },
  label: { color: "inherit" },
} as const;

/** 提交 hash 链接按钮：勿用 padding 简写，否则会盖掉 Mantine 对 section 的内边距 */
export const commitHashButtonStyles = {
  root: {
    fontFamily: "monospace",
    flexShrink: 0,
  },
  label: {
    lineHeight: 1.35,
  },
  section: {
    marginInlineStart: 4,
  },
} as const;
