import React from "react";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import App from "./App";

const theme = createTheme({
  primaryColor: "teal",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
  defaultRadius: "md",
  colors: {
    dark: [
      "#e0e0e0", // 0: text / lightest
      "#b0b8c8", // 1: secondary text
      "#8892b0", // 2: dim text
      "#5a6a8a", // 3: disabled
      "#2a3050", // 4: border / divider
      "#1a1f3a", // 5: card surface
      "#0f1629", // 6: elevated bg
      "#0a0e27", // 7: main bg
      "#080b1e", // 8: deeper bg
      "#050714", // 9: deepest
    ],
    teal: [
      "#e6fcf5",
      "#b2f5e0",
      "#7aebca",
      "#4ddbb3",
      "#2ac99a",
      "#64ffda", // 5: primary accent (matches existing #64ffda)
      "#0fb885",
      "#0d9a6f",
      "#0a7d5a",
      "#075f45",
    ],
  },
  primaryShade: { light: 5, dark: 5 },
  components: {
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
        overlayProps: {
          backgroundOpacity: 0.7,
          blur: 4,
        },
      },
    },
    Button: {
      defaultProps: {
        size: "sm",
      },
    },
    Tooltip: {
      defaultProps: {
        openDelay: 400,
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
