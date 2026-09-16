import {
  Autocomplete, Loader, NumberInput, Select, SimpleGrid,
  Textarea, TextInput,
} from "@mantine/core";
import type { Dispatch, SetStateAction } from "react";
import { EMPTY_DEPLOY_FORM, HEALTH_PATH_OPTIONS } from "./types";
import { isRfc1123Name } from "./utils";

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
}: Props) {
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
      <TextInput
        label="镜像地址"
        placeholder="dockerhub.kubekey.local/tksy-admin/my-service:v1.0.0"
        value={form.image}
        onChange={(e) => setForm({ ...form, image: e.currentTarget.value })}
        required
        data-autofocus={imageAutoFocus || undefined}
      />
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
