import { RefreshCw } from "lucide-react";

export function KsRefreshIcon({ size = 13, spinning }: { size?: number; spinning?: boolean }) {
  return <RefreshCw size={size} className={spinning ? "ks-refresh-spin" : undefined} />;
}
