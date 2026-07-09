export type BatchPackResponseLike = {
  code?: number;
  unauthorized?: boolean;
};

export type BatchPackType = "subChannel" | "vest";

export function getBatchPackIdLabel(type: BatchPackType): string {
  return type === "vest" ? "马甲包 ID" : "子渠道 ID";
}

export function getBatchPackSubmitText(_type: BatchPackType): string {
  return "提交打包加速";
}

export function parseSubChannelIds(input: string): string[] {
  const ids = input
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

export function isBatchPackUnauthorized(response: BatchPackResponseLike): boolean {
  return Boolean(response.unauthorized) || response.code === 401;
}
