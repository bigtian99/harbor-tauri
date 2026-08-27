/** 本地上传时间（FTP 不经过宝塔面板，面板 addtime 不会变） */
const STORAGE: Record<"java" | "php", string> = {
  java: "jarporter.bt_last_upload.java",
  php: "jarporter.bt_last_upload.php",
};

function readMap(kind: "java" | "php"): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE[kind]);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMap(kind: "java" | "php", map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE[kind], JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

/** 与宝塔列表格式一致：本地时间 yyyy-MM-dd HH:mm:ss */
export function formatBtUploadNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function getBtLastUpload(kind: "java" | "php", id: string): string | undefined {
  const key = id.trim();
  if (!key) return undefined;
  return readMap(kind)[key];
}

export function setBtLastUpload(kind: "java" | "php", id: string, at?: string): void {
  const key = id.trim();
  if (!key) return;
  const map = readMap(kind);
  map[key] = at?.trim() || formatBtUploadNow();
  writeMap(kind, map);
}

/** 列表展示：优先本地上传时间，否则面板返回的 updated_at */
export function displayBtUpdatedAt(
  kind: "java" | "php",
  id: string,
  panelUpdatedAt: string,
): string {
  return getBtLastUpload(kind, id) || panelUpdatedAt.trim() || "-";
}
