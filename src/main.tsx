import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./theme/tokens.css";
import { appTheme } from "./theme/mantine";
import App from "./App";
import { ConfirmDialogProvider } from "./hooks/useConfirmDialog";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={appTheme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </MantineProvider>
  </React.StrictMode>,
);
