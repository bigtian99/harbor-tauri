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
            ? "扫描中，也可直接手输..."
            : springProfiles.length === 0
              ? "手输 profile，如 test / prod（可留空）"
              : "选择或手输 profile..."
        }
        loading={isLoadingProfiles}
      />
      <p className="template-hint">
        {springProfile
          ? `将执行: mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=${springProfile}`
          : springProfiles.length > 0
            ? `可从已检测 profile 选择，也可手输；检测到: ${springProfiles.join(", ")}`
            : "留空则不添加 -Dspring.profiles.active；也可直接手输自定义 profile"}
      </p>
    </div>
  );
}
