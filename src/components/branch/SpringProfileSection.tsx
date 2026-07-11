import { SearchableDropdown } from "../SearchableDropdown";

export interface SpringProfileSectionProps {
  springProfile: string;
  springProfiles: string[];
  isLoadingProfiles: boolean;
  onSpringProfileChange: (profile: string) => void;
}

/** Maven 分支打包的 Spring Profile 选择区 */
export function SpringProfileSection({
  springProfile,
  springProfiles,
  isLoadingProfiles,
  onSpringProfileChange,
}: SpringProfileSectionProps) {
  return (
    <div className="form-group">
      <label>Spring Profile</label>
      <SearchableDropdown
        value={springProfile}
        options={springProfiles}
        onChange={onSpringProfileChange}
        placeholder={
          isLoadingProfiles
            ? "扫描中..."
            : springProfiles.length === 0
              ? "未检测到 profile 配置文件"
              : "选择 profile..."
        }
        disabled={isLoadingProfiles}
        loading={isLoadingProfiles}
      />
      <p className="template-hint">
        {springProfile
          ? `将执行: mvn clean package -DskipTests -Dspring.profiles.active=${springProfile}`
          : springProfiles.length > 0
            ? `检测到 ${springProfiles.length} 个 profile: ${springProfiles.join(", ")}`
            : "留空则不添加 -Dspring.profiles.active 参数"}
      </p>
    </div>
  );
}
