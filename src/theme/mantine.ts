import { createTheme } from "@mantine/core";

/** 侧栏 / 列表项激活态：亮蓝浅底 + 左边线 */
const navActiveStyles = {
  root: {
    borderRadius: "var(--radius-md)",
    color: "var(--color-text-muted)",
    "--nav-icon-opacity": "0.6",
    "&[data-active]": {
      background: "var(--color-primary-muted)",
      color: "var(--color-primary)",
      border: "none",
      borderLeft: "none",
      boxShadow: "none",
      "--nav-icon-opacity": "1",
    },
    "&:hover:not([data-active])": {
      background: "rgba(120, 170, 255, 0.08)",
      color: "var(--color-text)",
    },
  },
  label: { fontSize: "13px", fontWeight: 600 },
  section: {
    color: "inherit",
    opacity: "var(--nav-icon-opacity)",
    transition: "opacity 0.15s ease",
  },
} as const;

/** 亮蓝阶 */
const sky = [
  "#f0f7ff",
  "#dcecff",
  "#b8d9ff",
  "#7ec8ff",
  "#3b9eff",
  "#1a7ff0",
  "#0d63cc",
  "#0a4fa3",
  "#083d7d",
  "#062b57",
] as const;

const duskDark = [
  "#eef3ff",
  "#c5d0e8",
  "#93a4c3",
  "#6b7d9e",
  "#4a5a78",
  "#2f3d58",
  "#182338",
  "#101826",
  "#0a0e17",
  "#060910",
] as const;

const fieldChrome = {
  label: { color: "var(--color-text)", fontWeight: 600 },
  input: {
    backgroundColor: "var(--color-bg-base)",
    borderColor: "var(--color-border-strong)",
    color: "var(--color-text)",
    "&:focus, &:focus-within": {
      borderColor: "var(--color-primary)",
      boxShadow: "0 0 0 3px var(--color-primary-muted)",
    },
  },
} as const;

export const appTheme = createTheme({
  primaryColor: "blue",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
  defaultRadius: "md",
  colors: {
    blue: [...sky],
    cyan: [...sky],
    dark: [...duskDark],
  },
  primaryShade: { light: 6, dark: 4 },
  components: {
    Button: {
      /* 关闭 autoContrast：亮蓝底不要黑字，统一白字 */
      defaultProps: { size: "sm", variant: "default", autoContrast: false },
      styles: {
        inner: {
          gap: 2,
        },
        section: {
          flexShrink: 0,
        },
        label: {
          overflow: "visible",
          lineHeight: 1.35,
          textBoxTrim: "none",
        },
        root: {
          fontWeight: 600,
          lineHeight: 1.35,
          transition: "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease",
          /* 次要：灰底描边 */
          "&[data-variant='default']": {
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-strong)",
            color: "var(--color-text)",
            "&:hover:not(:disabled)": {
              background: "var(--color-bg-card)",
              borderColor: "var(--color-primary)",
              color: "var(--color-primary-hover)",
            },
          },
          /* 主操作：实心主色 + 白字 */
          "&[data-variant='filled']:not(:disabled):not([data-disabled])": {
            border: "1px solid color-mix(in srgb, var(--color-primary-hover) 22%, transparent)",
            color: "var(--color-on-primary)",
            "--button-color": "var(--color-on-primary)",
            background: "var(--color-primary-solid)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset, 0 6px 16px rgba(13, 40, 80, 0.28)",
            "&:hover": {
              background: "var(--color-primary-solid-hover)",
              filter: "none",
              color: "var(--color-on-primary)",
              "--button-color": "var(--color-on-primary)",
              boxShadow: "0 1px 0 rgba(255,255,255,0.1) inset, 0 8px 18px rgba(13, 40, 80, 0.32)",
            },
          },
          "&[data-variant='filled']:not(:disabled):not([data-disabled]) .mantine-Button-label, &[data-variant='filled']:not(:disabled):not([data-disabled]) .mantine-Button-section": {
            color: "var(--color-on-primary)",
          },
          "&[data-variant='filled']:disabled, &[data-variant='filled'][data-disabled]": {
            background: "var(--color-bg-elevated) !important",
            color: "var(--color-text-muted) !important",
            "--button-color": "var(--color-text-muted)",
            border: "1px solid var(--color-border-strong)",
            boxShadow: "none",
            opacity: 0.55,
            cursor: "not-allowed",
            filter: "none",
          },
          "&[data-variant='filled']:disabled .mantine-Button-label, &[data-variant='filled'][data-disabled] .mantine-Button-label, &[data-variant='filled']:disabled .mantine-Button-section, &[data-variant='filled'][data-disabled] .mantine-Button-section": {
            color: "var(--color-text-muted) !important",
          },
          /* 轻强调：浅色底 */
          "&[data-variant='light']": {
            border: "1px solid transparent",
            "&:hover:not(:disabled)": {
              borderColor: "var(--color-primary-muted)",
            },
          },
          /* 描边强调 */
          "&[data-variant='outline']": {
            background: "transparent",
            borderWidth: 1,
            "&:hover:not(:disabled)": {
              background: "var(--color-primary-subtle)",
            },
          },
          /* 文字/幽灵 */
          "&[data-variant='subtle']": {
            background: "transparent",
            border: "none",
            color: "var(--color-text-muted)",
            fontWeight: 500,
            "&:hover:not(:disabled)": {
              background: "var(--color-primary-subtle)",
              color: "var(--color-primary-hover)",
            },
          },
          /* 渐变主 CTA */
          "&[data-variant='gradient']": {
            border: "none",
            color: "var(--color-on-primary)",
            "--button-color": "var(--color-on-primary)",
            boxShadow: "var(--glow-primary)",
            "&:hover:not(:disabled)": {
              filter: "brightness(1.06)",
              color: "var(--color-on-primary)",
            },
          },
        },
      },
    },
    Badge: {
      defaultProps: { variant: "light" },
      styles: {
        root: {
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
    ActionIcon: {
      defaultProps: { variant: "subtle", color: "gray" },
      styles: {
        root: {
          "&[data-variant='filled']": {
            boxShadow: "var(--glow-primary)",
          },
          "&[data-variant='light'][data-color='red'], &[data-variant='filled'][data-color='red']": {
            boxShadow: "0 0 12px rgba(248, 113, 113, 0.25)",
          },
        },
      },
    },
    NavLink: {
      defaultProps: { variant: "subtle", color: "blue" },
      styles: navActiveStyles,
    },
    Tabs: {
      styles: {
        tab: {
          color: "var(--color-text-muted)",
          "&[data-active]": {
            color: "var(--color-primary-hover)",
            borderColor: "var(--color-primary)",
          },
        },
      },
    },
    Checkbox: {
      styles: {
        input: {
          backgroundColor: "var(--color-bg-elevated)",
          borderColor: "var(--color-border-strong)",
        },
      },
    },
    Switch: {
      defaultProps: { color: "blue" },
    },
    Table: {
      defaultProps: {
        striped: false,
        highlightOnHover: true,
        withTableBorder: false,
        withColumnBorders: false,
      },
    },
    Modal: {
      defaultProps: {
        centered: true,
        overlayProps: { backgroundOpacity: 0.65, blur: 3 },
      },
      styles: {
        content: {
          background: "var(--color-bg-surface)",
          border: "1px solid var(--color-border-strong)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.55), var(--glow-primary)",
        },
      },
    },
    Tooltip: { defaultProps: { openDelay: 400 } },
    Pagination: {
      defaultProps: {
        color: "blue",
        radius: "sm",
        size: "sm",
        autoContrast: true,
      },
      vars: () => ({
        root: {
          "--pagination-active-bg": "var(--color-primary-muted)",
          "--pagination-active-color": "var(--color-primary-hover)",
        },
      }),
    },
    TextInput: {
      styles: fieldChrome,
    },
    PasswordInput: {
      styles: fieldChrome,
    },
    Textarea: {
      styles: fieldChrome,
    },
    NumberInput: {
      styles: fieldChrome,
    },
    Select: {
      defaultProps: { radius: "sm" },
      styles: { input: fieldChrome.input },
    },
    Paper: {
      styles: {
        root: {
          background:
            "linear-gradient(165deg, color-mix(in srgb, var(--color-bg-card) 88%, var(--color-primary-solid)) 0%, var(--color-bg-card) 55%)",
          border: "1px solid var(--color-border-strong)",
          boxShadow: "0 8px 28px rgba(0, 0, 0, 0.28)",
        },
      },
    },
    Progress: {
      defaultProps: {
        size: "sm",
        radius: "xl",
        transitionDuration: 420,
      },
      classNames: {
        root: "jp-progress-mantine",
        section: "jp-progress-mantine-section",
      },
      styles: {
        root: {
          background: "var(--progress-track-bg)",
          border: "1px solid var(--progress-track-border)",
          boxShadow: "var(--progress-track-shadow)",
          overflow: "hidden",
          minHeight: 8,
        },
        section: {
          background: "var(--progress-fill-gradient)",
          boxShadow: "var(--progress-fill-glow)",
          transition: "var(--progress-transition)",
          borderRadius: "inherit",
        },
      },
    },
    Title: {
      styles: {
        root: { color: "var(--color-text)" },
      },
    },
  },
});
