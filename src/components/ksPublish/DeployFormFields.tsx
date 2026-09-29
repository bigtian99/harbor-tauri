import {
  Autocomplete, Button, Group, Loader, NumberInput, SegmentedControl, Select, SimpleGrid,
  Stack, Text, Textarea, TextInput,
} from "@mantine/core";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { RefreshCw } from "lucide-react";
import {
  EMPTY_DEPLOY_FORM, HEALTH_PATH_OPTIONS,
  type KsCreateGitForm, type KsImageSource,
} from "./types";
import { isRfc1123Name } from "./utils";
import {
  describeKsBatchNpmScriptPref,
  KS_BATCH_NPM_SCRIPT_PRESETS,
  type KsBatchNpmScriptMode,
  type KsBatchNpmScriptPref,
} from "../../utils/ksBatchPackPublish";
import { buildKsBatchBranchOptionGroups } from "../../utils/ksBatchGitBranches";
import { loadKsBatchBranchHistory } from "../../utils/ksBatchBranchHistory";
import { mavenModuleOptions, AUTO_MAVEN_MODULE, type MavenModuleInfo } from "../../utils/ksMavenModules";

export type KsCmSelectProps = {
  cms: { name: string; alias: string; dataSize: number }[];
  cmLoading: boolean;
  cmSelectPlaceholder: string;
};

export type DeployFormState = typeof EMPTY_DEPLOY_FORM;

type Props = {
  form: DeployFormState;
  setForm: Dispatch<SetStateAction<DeployFormState>>;
  /** create：名称可编辑并自动转小写；edit：名称只读 */
  nameEditable: boolean;
  cms: KsCmSelectProps["cms"];
  cmLoading: boolean;
  cmSelectPlaceholder: string;
  /** 编辑弹窗镜像框自动聚焦 */
  imageAutoFocus?: boolean;
  /** 镜像来源：image=直接填镜像地址（默认）；git=填 Git 地址，创建时先构建推送 */
  sourceMode?: KsImageSource;
  /** sourceMode==='git' 时的 Git 构建表单 */
  git?: KsCreateGitForm;
  setGit?: Dispatch<SetStateAction<KsCreateGitForm>>;
  /** 基于 Git 地址 git fetch 出的分支（下拉） */
  gitBranches?: string[];
  gitBranchesLoading?: boolean;
  gitBranchesError?: string;
  /** Git 地址解析到的本地仓库路径（仅成功解析时有值） */
  gitRepoPath?: string | null;
  /** 本地仓库内可执行的 Spring Boot Maven 模块（供手选打包模块） */
  mavenModules?: MavenModuleInfo[];
  mavenModulesLoading?: boolean;
  /** 拉取分支：force=false 供失焦自动触发（同 URL 不重复），true 供按钮强制刷新 */
  onRefreshGitBranches?: (force?: boolean) => void;
};

/** 创建 / 编辑 Deployment 共用字段（名称可编辑性由 nameEditable 控制） */
export function DeployFormFields({
  form,
  setForm,
  nameEditable,
  cms,
  cmLoading,
  cmSelectPlaceholder,
  imageAutoFocus,
  sourceMode = "image",
  git,
  setGit,
  gitBranches,
  gitBranchesLoading,
  gitBranchesError,
  gitRepoPath,
  mavenModules,
  mavenModulesLoading,
  onRefreshGitBranches,
}: Props) {
  const gitMode = sourceMode === "git";
  const npmPref = useMemo<KsBatchNpmScriptPref>(
    () => ({ mode: git?.npmMode ?? "auto", customScript: git?.npmCustom ?? "" }),
    [git?.npmMode, git?.npmCustom],
  );
  const branchGroups = useMemo(
    () => buildKsBatchBranchOptionGroups(gitBranches ?? [], loadKsBatchBranchHistory()),
    [gitBranches],
  );
  const branchData = useMemo(() => {
    if (branchGroups.length > 0) return branchGroups;
    const seed = git?.branch?.trim();
    return seed ? [seed] : [];
  }, [branchGroups, git?.branch]);
  const gitBranchSet = useMemo(() => new Set(gitBranches ?? []), [gitBranches]);
  const branchNotInList =
    !!git?.branch?.trim() && gitBranchSet.size > 0 && !gitBranchSet.has(git.branch.trim());
  const updateGit = (patch: Partial<KsCreateGitForm>) => {
    setGit?.((prev) => ({ ...prev, ...patch }));
  };

  return (
    <>
      <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
        <TextInput
          label="部署名称"
          description={
            nameEditable
              ? "须小写字母/数字/'-'/'.'（会自动转小写）"
              : "修改时不可更改"
          }
          placeholder={nameEditable ? "klcj-test-service" : undefined}
          value={form.name}
          readOnly={!nameEditable}
          onChange={nameEditable ? (e) => {
            const name = e.currentTarget.value.toLowerCase();
            setForm((prev) => ({
              ...prev,
              name,
              // 别名未手改（空或仍等于旧部署名）时跟随；后端空别名也会落成部署名
              alias: !prev.alias.trim() || prev.alias === prev.name ? name : prev.alias,
            }));
          } : undefined}
          error={
            nameEditable && form.name.trim() && !isRfc1123Name(form.name)
              ? "名称不符合 K8s 规范"
              : undefined
          }
          required
        />
        <TextInput
          label="别名（显示名）"
          description="KubeSphere 控制台显示名；默认跟随部署名称，可改"
          placeholder="默认与部署名称相同"
          value={form.alias}
          onChange={(e) => setForm({ ...form, alias: e.currentTarget.value })}
        />
      </SimpleGrid>
      {gitMode ? (
        <>
          <TextInput
            label="Git 地址"
            description="先按该 Git 打包推送镜像，再用产出的镜像创建部署（本地仓库需在「分支打包」里打开过）"
            placeholder="git@gitlab.tksy.com:tksy-middle/my-service.git"
            value={git?.url ?? ""}
            onChange={(e) => updateGit({ url: e.currentTarget.value })}
            onBlur={() => onRefreshGitBranches?.(false)}
            required
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Stack gap={6}>
            <Group gap={8} align="flex-end" wrap="nowrap">
              <Select
                label="分支"
                description="基于上方 Git 地址拉取（git ls-remote），下拉选择；远端分支写 origin/xxx"
                placeholder={gitBranchesLoading ? "正在拉取分支…" : "填写 Git 地址后自动拉取"}
                data={branchData}
                value={git?.branch ?? null}
                onChange={(v) => updateGit({ branch: v ?? "" })}
                searchable
                nothingFoundMessage={gitBranchesLoading ? "正在拉取…" : "无匹配分支"}
                disabled={gitBranchesLoading}
                style={{ flex: 1 }}
                required
              />
              <Button
                variant="default"
                size="xs"
                leftSection={gitBranchesLoading ? <Loader size={12} /> : <RefreshCw size={12} />}
                disabled={gitBranchesLoading || !git?.url?.trim()}
                onClick={() => onRefreshGitBranches?.(true)}
              >
                拉取分支
              </Button>
            </Group>
            <Text size="xs" c={gitBranchesError ? "red" : "dimmed"}>
              {gitBranchesLoading
                ? "正在拉取仓库分支…"
                : gitBranchesError
                  ? gitBranchesError
                  : gitBranches && gitBranches.length > 0
                    ? `已拉取 ${gitBranches.length} 个分支${gitRepoPath ? `（本地仓库 ${gitRepoPath}）` : ""}`
                    : "填写 Git 地址后失焦自动拉取，或点「拉取分支」"}
            </Text>
            {branchNotInList && (
              <Text size="xs" c="orange">
                「{git!.branch.trim()}」不在已拉取的分支里，请确认仓库存在该引用
              </Text>
            )}
          </Stack>
          <Stack gap={6}>
            <Text size="sm" fw={600}>构建类型</Text>
            <SegmentedControl
              fullWidth
              size="xs"
              value={git?.role ?? "backend"}
              onChange={(v) => updateGit({ role: v === "frontend" ? "frontend" : "backend" })}
              data={[
                { label: "后端（Maven / JAR）", value: "backend" },
                { label: "前端（npm / dist）", value: "frontend" },
              ]}
            />
          </Stack>
          {git?.role === "backend" && (
            <Stack gap={6}>
              <Select
                label="Maven 模块（可选）"
                description="多模块仓库可手动指定要打包的 Spring Boot 子模块；默认按部署名自动匹配"
                data={mavenModuleOptions(mavenModules ?? [])}
                value={git?.mavenModule || AUTO_MAVEN_MODULE}
                onChange={(v) => updateGit({ mavenModule: v && v !== AUTO_MAVEN_MODULE ? v : "" })}
                searchable
                disabled={mavenModulesLoading}
                rightSection={mavenModulesLoading ? <Loader size={14} /> : undefined}
                nothingFoundMessage="未扫描到可执行模块"
              />
              <Text size="xs" c="dimmed">
                {mavenModulesLoading
                  ? "正在扫描仓库的 Maven 模块…"
                  : (mavenModules?.length ?? 0) > 1
                    ? `已扫描到 ${mavenModules?.length} 个可执行模块；部署名对不上时在此手动指定`
                    : (mavenModules?.length ?? 0) === 1
                      ? "仓库仅 1 个可执行模块，一般无需手选"
                      : "解析到本地仓库后可手选（未打开过该仓库时走自动匹配）"}
              </Text>
            </Stack>
          )}
          {git?.role === "frontend" && (
            <Stack gap={6}>
              <Text size="sm" fw={600}>前端 npm 构建脚本</Text>
              <SegmentedControl
                fullWidth
                size="xs"
                value={git?.npmMode ?? "auto"}
                onChange={(v) => {
                  const mode = (
                    v === "prod" || v === "test" || v === "custom" ? v : "auto"
                  ) as KsBatchNpmScriptMode;
                  const patch: Partial<KsCreateGitForm> = { npmMode: mode };
                  if (mode === "prod") patch.npmCustom = "build:prod";
                  if (mode === "test") patch.npmCustom = "build:test";
                  updateGit(patch);
                }}
                data={[
                  { label: "按分支自动", value: "auto" },
                  { label: "build:prod", value: "prod" },
                  { label: "build:test", value: "test" },
                  { label: "自定义", value: "custom" },
                ]}
              />
              {git?.npmMode === "auto" && (
                <Text size="xs" c="dimmed">
                  rc-master 分支 → build:prod，其它分支 → build:test
                </Text>
              )}
              {git?.npmMode === "custom" && (
                <Autocomplete
                  placeholder="输入 npm script 名，如 build:prod"
                  data={[...KS_BATCH_NPM_SCRIPT_PRESETS]}
                  value={git?.npmCustom ?? ""}
                  onChange={(v) => updateGit({ npmCustom: v })}
                  aria-label="自定义 npm 构建脚本"
                  comboboxProps={{ withinPortal: true }}
                />
              )}
              <Text size="xs" c="dimmed">{describeKsBatchNpmScriptPref(npmPref)}</Text>
            </Stack>
          )}
        </>
      ) : (
        <TextInput
          label="镜像地址"
          placeholder="dockerhub.kubekey.local/tksy-admin/my-service:v1.0.0"
          value={form.image}
          onChange={(e) => setForm({ ...form, image: e.currentTarget.value })}
          required
          data-autofocus={imageAutoFocus || undefined}
        />
      )}
      <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
        <NumberInput
          label="容器端口"
          description="写入 containerPort，并作为三探针探测端口"
          value={form.port}
          onChange={(v) => setForm({ ...form, port: typeof v === "number" ? v : 8080 })}
          min={1}
          max={65535}
          required
        />
        <NumberInput
          label="副本数"
          description="Deployment spec.replicas"
          value={form.replicas}
          onChange={(v) => setForm({ ...form, replicas: typeof v === "number" ? v : 1 })}
          min={0}
          max={100}
        />
      </SimpleGrid>
      <Autocomplete
        label="健康检查路径"
        description="写入 liveness / readiness / startup 三探针；可下拉选择或手动输入"
        placeholder="/actuator/health"
        data={[...HEALTH_PATH_OPTIONS]}
        filter={({ options }) => options}
        value={form.healthPath}
        onChange={(v) => setForm({ ...form, healthPath: v })}
        required
      />
      <Select
        label="引用配置字典"
        description="对齐 KubeSphere：读取该 ConfigMap 全部 key，逐项生成 env.valueFrom.configMapKeyRef"
        placeholder={cmSelectPlaceholder}
        data={cms.map((item) => ({
          value: item.name,
          label: item.alias
            ? `${item.name}（${item.alias} · ${item.dataSize} keys）`
            : `${item.name}（${item.dataSize} keys）`,
        }))}
        value={form.configMap}
        onChange={(v) => setForm({ ...form, configMap: v })}
        searchable
        clearable
        disabled={!cmLoading && cms.length === 0}
        rightSection={cmLoading ? <Loader size={16} /> : undefined}
        nothingFoundMessage="无匹配配置字典"
      />
      <Textarea
        label="环境变量（可选，K=V 每行一个，可与配置字典叠加）"
        placeholder={"TZ=Asia/Shanghai\nSPRING_DATA_REDIS_SENTINEL_MASTER=mymaster"}
        value={form.envs}
        onChange={(e) => setForm({ ...form, envs: e.currentTarget.value })}
        minRows={4}
        autosize
        maxRows={12}
        styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
        spellCheck={false}
      />
    </>
  );
}
