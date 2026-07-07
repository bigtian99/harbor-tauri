export type BatchPackResponseLike = {
  code?: number;
  unauthorized?: boolean;
};

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
