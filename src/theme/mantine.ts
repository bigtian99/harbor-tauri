import { createTheme } from "@mantine/core";

/** 侧栏 / 列表项激活态：亮蓝浅底 + 左边线 */
const navActiveStyles = {
  root: {
    borderRadius: "var(--radius-md)",
    color: "var(--color-text-muted)",
    "--nav-icon-opacity": "0.6",
    "&[data-active]": {
      background: "var(--color-primary-muted)",
      color: "var(--color-primary-hover)",
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
        root: {
          fontWeight: 600,
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
          "&[data-variant='filled']": {
            border: "none",
            color: "#fff",
            "--button-color": "#fff",
            boxShadow: "var(--glow-primary)",
            "&:hover:not(:disabled)": {
              filter: "brightness(1.08)",
              color: "#fff",
              "--button-color": "#fff",
              boxShadow: "0 0 28px rgba(59, 158, 255, 0.32)",
            },
          },
          "&[data-variant='filled'] .mantine-Button-label, &[data-variant='filled'] .mantine-Button-section": {
            color: "#fff",
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
            color: "#fff",
            "--button-color": "#fff",
            boxShadow: "var(--glow-primary)",
            "&:hover:not(:disabled)": {
              filter: "brightness(1.06)",
              color: "#fff",
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
      styles: {
        label: { color: "var(--color-text)", fontWeight: 600 },
        input: {
          backgroundColor: "var(--color-bg-base)",
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text)",
        },
      },
    },
    PasswordInput: {
      styles: {
        label: { color: "var(--color-text)", fontWeight: 600 },
        input: {
          backgroundColor: "var(--color-bg-base)",
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text)",
        },
      },
    },
    Textarea: {
      styles: {
        label: { color: "var(--color-text)", fontWeight: 600 },
        input: {
          backgroundColor: "var(--color-bg-base)",
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text)",
        },
      },
    },
    NumberInput: {
      styles: {
        label: { color: "var(--color-text)", fontWeight: 600 },
        input: {
          backgroundColor: "var(--color-bg-base)",
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text)",
        },
      },
    },
    Select: {
      defaultProps: { radius: "sm" },
      styles: {
        input: {
          backgroundColor: "var(--color-bg-base)",
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text)",
        },
      },
    },
    Paper: {
      styles: {
        root: {
          background:
            "linear-gradient(165deg, color-mix(in srgb, var(--color-bg-card) 88%, #1a3a6a) 0%, var(--color-bg-card) 55%)",
          border: "1px solid var(--color-border-strong)",
          boxShadow: "0 8px 28px rgba(0, 0, 0, 0.28)",
        },
      },
    },
    Progress: {
      styles: {
        root: { background: "var(--color-bg-elevated)" },
        section: {
          background: "linear-gradient(90deg, var(--color-primary), var(--color-accent))",
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
