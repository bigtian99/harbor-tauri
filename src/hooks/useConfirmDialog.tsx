import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";

export interface ConfirmOptions {
  title: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  loading: boolean;
}

const CLOSED: ConfirmState = {
  open: false,
  loading: false,
  title: "",
  message: "",
  variant: "default",
};

type ConfirmDialogContextValue = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

function useConfirmDialogState() {
  const [state, setState] = useState<ConfirmState>(CLOSED);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ ...opts, open: true, loading: false });
    });
  }, []);

  const onConfirm = useCallback(() => {
    setState(CLOSED);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const onCancel = useCallback(() => {
    setState(CLOSED);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return {
    confirm,
    dialogProps: {
      open: state.open,
      title: state.title,
      message: state.message,
      details: state.details,
      confirmLabel: state.confirmLabel,
      cancelLabel: state.cancelLabel,
      variant: state.variant,
      loading: state.loading,
      onConfirm,
      onCancel,
    },
  };
}

/** App 根节点挂载一次，全应用共用同一套 ConfirmDialog 样式 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { confirm, dialogProps } = useConfirmDialogState();
  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}
      <ConfirmDialog {...dialogProps} />
    </ConfirmDialogContext.Provider>
  );
}

/**
 * 命令式确认弹窗：`const ok = await confirm({ title, message })`.
 * 须在 `ConfirmDialogProvider` 内使用（已在 main.tsx 挂载）。
 */
export function useConfirmDialog(): ConfirmDialogContextValue {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error("useConfirmDialog must be used within ConfirmDialogProvider");
  }
  return ctx;
}
