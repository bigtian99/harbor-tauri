/**
 * KubeSphere 批量打包的 Spring Profile 解析（纯函数，便于单测）。
 *
 * 语义与「分支打包」一致：
 * - override === undefined → 沿用该仓库记忆的 profile（不改变原有行为）
 * - override 为字符串（含空串） → 以用户本次选择为准，空串表示不加 -Dspring.profiles.active
 */
export function resolveBatchSpringProfile(
  rememberedProfile: string,
  override?: string,
): string {
  const value = override === undefined ? rememberedProfile : override;
  return (value ?? "").trim();
}

/** 展示用：Maven 实际执行命令（与分支打包 computeDefaultBuildCommand 对齐） */
export function describeBatchMavenCommand(springProfile: string): string {
  const profile = springProfile.trim();
  return profile
    ? `mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=${profile}`
    : "mvn clean package -Dmaven.test.skip=true";
}
