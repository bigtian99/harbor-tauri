import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Grid,
  NumberInput,
  Paper,
  PasswordInput,
  Popover,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  Play,
  Save,
  Search,
} from "lucide-react";

import type {
  HarborConfig,
  HonorCheckParams,
  HonorDbConfig,
  HonorDbTestResult,
  HonorDeviceCheckResult,
  HonorProgressPayload,
  HonorReportParams,
  HonorReportSummary,
} from "../types";
import { isTauriRuntime } from "../types";
import { PanelPageHeader } from "./PanelPageHeader";
import "../styles/ops-panel.css";

type HonorDbForm = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  table: string;
};

type DateMode = "today" | "date" | "all";

type HonorProgress = {
  percent: number;
  message: string;
  current: number;
  total: number;
};

const DEFAULT_DB_FORM: HonorDbForm = {
  host: "rm-gdy8njy6.mysql.rds.aliyuncs.com",
  port: "3306",
  user: "tksy_admin",
  password: "",
  database: "tksy_admin_2",
  table: "",
};

const EVENT_LABELS: Record<string, string> = {
  activate: "激活",
  register: "注册",
  pay: "付费",
};

const OUTCOME_COLOR: Record<string, string> = {
  success: "teal",
  failed: "red",
  error: "red",
  unknown: "yellow",
  "dry-run": "blue",
};

const MAX_LOG_LINES = 400;

/** 预检结果列表的一行：左标签右值 */
function CheckRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" gap="md" wrap="nowrap">
      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="xs" style={{ wordBreak: "break-all", textAlign: "right" }}>
        {value}
      </Text>
    </Group>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** 自绘月历：主题配色、固定尺寸，只允许选择不晚于 max 的日期 */
function MonthCalendar({
  value,
  max,
  onChange,
}: {
  value: string;
  max: string;
  onChange: (value: string) => void;
}) {
  const initial = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date();
  const [cursor, setCursor] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const maxDate = new Date(`${max}T00:00:00`);
  const atMaxMonth =
    cursor.year * 12 + cursor.month >= maxDate.getFullYear() * 12 + maxDate.getMonth();

  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leadingBlanks = new Date(cursor.year, cursor.month, 1).getDay();
  const cellCount = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  function shiftMonth(delta: number) {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }

  return (
    <Stack gap={6} w={278}>
      <Group justify="space-between" gap="xs">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          aria-label="上个月"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft size={18} />
        </ActionIcon>
        <Text size="sm" fw={600}>
          {cursor.year} 年 {cursor.month + 1} 月
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          aria-label="下个月"
          disabled={atMaxMonth}
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight size={18} />
        </ActionIcon>
      </Group>
      <SimpleGrid cols={7} spacing={4} verticalSpacing={4}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} size="xs" c="dimmed" ta="center">
            {label}
          </Text>
        ))}
        {Array.from({ length: cellCount }, (_, idx) => {
          const day = idx - leadingBlanks + 1;
          if (day < 1 || day > daysInMonth) {
            return <span key={`blank-${idx}`} />;
          }
          const dateStr = `${cursor.year}-${pad2(cursor.month + 1)}-${pad2(day)}`;
          return (
            <UnstyledButton
              key={dateStr}
              className="honor-calendar-day"
              disabled={dateStr > max}
              data-selected={dateStr === value ? "true" : "false"}
              data-today={dateStr === todayStr() ? "true" : "false"}
              onClick={() => onChange(dateStr)}
            >
              {day}
            </UnstyledButton>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

function numberFrom(value: number | string, fallback: number) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function HonorReportPanel({
  config,
  onPatchConfig,
}: {
  config: HarborConfig;
  onPatchConfig: (patch: Partial<HarborConfig>) => void;
}) {
  const [db, setDb] = useState<HonorDbForm>(DEFAULT_DB_FORM);
  const [dbTouched, setDbTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<HonorDbTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<HonorDeviceCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkSig, setCheckSig] = useState<string | null>(null);

  const [activate, setActivate] = useState<number>(30);
  const [register, setRegister] = useState<number>(25);
  const [pay, setPay] = useState<number>(15);
  const [intervalSec, setIntervalSec] = useState<number>(0.3);
  const [dateMode, setDateMode] = useState<DateMode>("all");
  const [customDate, setCustomDate] = useState("");
  const [dedupe, setDedupe] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [calOpen, setCalOpen] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<HonorProgress>({
    percent: 0,
    message: "",
    current: 0,
    total: 0,
  });
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<HonorReportSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // 数据源字段：仅在用户未手动改过时，从加载完成的配置里补种
  useEffect(() => {
    if (dbTouched) return;
    const host = config.honor_db_host ?? "";
    if (!host && !config.honor_db_user) return;
    setDb({
      host,
      port: String(config.honor_db_port ?? 3306),
      user: config.honor_db_user ?? "",
      password: config.honor_db_pass ?? "",
      database: config.honor_db_name ?? "",
      table: config.honor_db_table ?? "",
    });
  }, [config, dbTouched]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .listen<HonorProgressPayload>("honor-report-progress", (event) => {
        const payload = event.payload;
        setProgress({
          percent: payload.percent,
          message: payload.message,
          current: payload.current,
          total: payload.total,
        });
        if (payload.line) {
          setLines((prev) => {
            const next = [...prev, payload.line as string];
            return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
          });
        }
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    // 新日志滚动到底部
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [lines]);

  function patchDb(patch: Partial<HonorDbForm>) {
    setDbTouched(true);
    setDb((prev) => ({ ...prev, ...patch }));
  }

  function buildDbConfig(): HonorDbConfig {
    return {
      host: db.host.trim(),
      port: numberFrom(db.port, 3306),
      user: db.user.trim(),
      password: db.password,
      database: db.database.trim(),
      table: db.table.trim(),
    };
  }

  const dbReady = Boolean(db.host.trim() && db.user.trim() && db.database.trim());
  const funnelInvalid = activate < register || register < pay;
  const dateInvalid = dateMode === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(customDate.trim());

  // 预检结论只在参数未变时有效：数量/日期/去重/数据源一旦改动必须重新查询，防止拿旧结论发送
  function checkSignature() {
    return JSON.stringify({
      host: db.host.trim(),
      port: numberFrom(db.port, 3306),
      user: db.user.trim(),
      database: db.database.trim(),
      table: db.table.trim(),
      activate,
      register,
      pay,
      dateMode,
      date: dateMode === "date" ? customDate.trim() : null,
      dedupe,
    });
  }
  const checkFresh = checkSig !== null && checkSig === checkSignature();
  const checkEnough = checkFresh && checkResult?.enough === true;
  const canRun = dbReady && !funnelInvalid && !dateInvalid && !running && checkEnough;

  async function handleSave() {
    setSaving(true);
    try {
      onPatchConfig({
        honor_db_host: db.host.trim(),
        honor_db_port: numberFrom(db.port, 3306),
        honor_db_user: db.user.trim(),
        honor_db_pass: db.password,
        honor_db_name: db.database.trim(),
        honor_db_table: db.table.trim(),
      });
      notifications.show({ message: "数据源已保存", color: "blue", autoClose: 2500 });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!isTauriRuntime()) {
      setTestError("请在桌面端测试连接");
      return;
    }
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await invoke<HonorDbTestResult>("honor_test_db", { db: buildDbConfig() });
      setTestResult(result);
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }

  /** 设备预检：按当前数量/日期/去重口径只读查库，不发送任何回传 */
  async function handleCheck() {
    if (!isTauriRuntime()) {
      setCheckError("请在桌面端查询设备");
      return;
    }
    if (!dbReady) {
      setCheckError("请先填写主机 / 用户名 / 数据库");
      return;
    }
    if (funnelInvalid) {
      setCheckError("数量必须满足 激活 ≥ 注册 ≥ 付费");
      return;
    }
    if (dateInvalid) {
      setCheckError("日期格式应为 YYYY-MM-DD");
      return;
    }
    setChecking(true);
    setCheckError(null);
    const date = dateMode === "all" ? null : dateMode === "today" ? todayStr() : customDate.trim();
    const sig = checkSignature();
    try {
      const params: HonorCheckParams = {
        db: buildDbConfig(),
        activate,
        register,
        pay,
        date,
        dedupe,
      };
      const result = await invoke<HonorDeviceCheckResult>("honor_check_devices", { params });
      setCheckResult(result);
      setCheckSig(sig);
    } catch (e) {
      setCheckResult(null);
      setCheckSig(null);
      setCheckError(String(e));
    } finally {
      setChecking(false);
    }
  }

  async function handleRun() {
    if (!canRun) return;
    if (!isTauriRuntime()) {
      notifications.show({ message: "请在桌面端执行回传", color: "yellow", autoClose: 3000 });
      return;
    }
    setRunning(true);
    setSummary(null);
    setRunError(null);
    setLines([]);
    setProgress({ percent: 1, message: "准备回传...", current: 0, total: 0 });
    const date = dateMode === "all" ? null : dateMode === "today" ? todayStr() : customDate.trim();
    const params: HonorReportParams = {
      db: buildDbConfig(),
      activate,
      register,
      pay,
      interval_ms: Math.round(intervalSec * 1000),
      date,
      dedupe,
      dry_run: dryRun,
    };
    try {
      const result = await invoke<HonorReportSummary>("honor_batch_report", { params });
      setSummary(result);
      notifications.show({
        message: dryRun
          ? `试运行完成：共 ${result.total} 条（未发送）`
          : `回传完成：共 ${result.total} 条`,
        color: "blue",
        autoClose: 4000,
      });
    } catch (e) {
      setRunError(String(e));
      notifications.show({ title: "回传失败", message: String(e), color: "red", autoClose: 8000 });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Box className="honor-report-panel">
      <Stack gap="md">
        <PanelPageHeader
          eyebrow="HONOR ADS CONVERSION POSTBACK"
          title="荣耀监测回传"
          sub="从投流库读取荣耀点击设备，按 激活 ⊇ 注册 ⊇ 付费 漏斗批量回传转化"
        />

        <Paper p="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Text size="sm" fw={600}>
                数据源（投流库 MySQL）
              </Text>
              <Group gap="xs">
                <Button
                  size="compact-sm"
                  variant="default"
                  className="ops-btn-secondary"
                  leftSection={<Save size={14} />}
                  loading={saving}
                  onClick={handleSave}
                >
                  保存数据源
                </Button>
                <Button
                  size="compact-sm"
                  variant="default"
                  className="ops-btn-secondary"
                  leftSection={
                    testing ? <Loader2 size={14} className="spin" /> : <Database size={14} />
                  }
                  loading={testing}
                  onClick={handleTest}
                >
                  测试连接
                </Button>
              </Group>
            </Group>
            <Grid>
              <Grid.Col span={{ base: 12, xs: 6, md: 5 }}>
                <TextInput
                  label="主机"
                  value={db.host}
                  onChange={(e) => patchDb({ host: e.currentTarget.value })}
                  placeholder="rm-xxxx.mysql.rds.aliyuncs.com"
                />
              </Grid.Col>
              <Grid.Col span={{ base: 4, xs: 2, md: 2 }}>
                <NumberInput
                  label="端口"
                  value={numberFrom(db.port, 3306)}
                  onChange={(v) => patchDb({ port: String(v ?? 3306) })}
                  min={1}
                  max={65535}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 8, xs: 4, md: 5 }}>
                <TextInput
                  label="数据库"
                  value={db.database}
                  onChange={(e) => patchDb({ database: e.currentTarget.value })}
                  placeholder="tksy-media"
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, xs: 6, md: 4 }}>
                <TextInput
                  label="用户名"
                  value={db.user}
                  onChange={(e) => patchDb({ user: e.currentTarget.value })}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, xs: 6, md: 4 }}>
                <PasswordInput
                  label="密码"
                  value={db.password}
                  onChange={(e) => patchDb({ password: e.currentTarget.value })}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <TextInput
                  label="点击表"
                  value={db.table}
                  onChange={(e) => patchDb({ table: e.currentTarget.value })}
                  placeholder="留空自动识别（click_log / media_click_log / tksy_media_click_log）"
                />
              </Grid.Col>
            </Grid>
            <Text size="xs" c="dimmed">
              凭据保存在本机配置文件（~/.config/jarporter/config.json），源码不落明文密码。
            </Text>

            {testError && (
              <Alert color="red" variant="light" title="连接失败" withCloseButton onClose={() => setTestError(null)}>
                {testError}
              </Alert>
            )}
            {testResult && !testError && (
              <Alert
                color={testResult.ok ? "teal" : "yellow"}
                variant="light"
                title={testResult.ok ? "测试连接成功" : "连接异常"}
                withCloseButton
                onClose={() => setTestResult(null)}
              >
                {testResult.message}
                {testResult.missing_columns.length > 0 && (
                  <Text size="sm" mt={4}>
                    缺少回传必需列：{testResult.missing_columns.join(", ")}
                  </Text>
                )}
              </Alert>
            )}
          </Stack>
        </Paper>

        <Paper p="md" radius="md">
          <Stack gap="sm">
            <Text size="sm" fw={600}>
              回传计划
            </Text>
            <Text size="xs" c="dimmed">
              按脚本口径批量回传：三个数量共用同一批设备（激活 ⊇ 注册 ⊇ 付费 取前缀子集）；
              同一设备复用同一条点击的 trackId / oaid / advertiserId；conversionTime 从点击时间上限
              +1s 起步逐条递增；付费事件的金额与订单号由系统内部生成。先「查询设备」确认有数据再回传，没数据会提示且不会发送。
            </Text>
            <Grid>
              <Grid.Col span={{ base: 4, xs: 3, md: 2 }}>
                <NumberInput
                  label="激活数"
                  value={activate}
                  onChange={(v) => setActivate(numberFrom(v, 1))}
                  min={1}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 4, xs: 3, md: 2 }}>
                <NumberInput
                  label="注册数"
                  value={register}
                  onChange={(v) => setRegister(numberFrom(v, 0))}
                  min={0}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 4, xs: 3, md: 2 }}>
                <NumberInput
                  label="付费数"
                  value={pay}
                  onChange={(v) => setPay(numberFrom(v, 0))}
                  min={0}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 3, md: 2 }}>
                <NumberInput
                  label="请求间隔（秒）"
                  value={intervalSec}
                  onChange={(v) => setIntervalSec(numberFrom(v, 0))}
                  step={0.1}
                  min={0}
                  max={10}
                />
              </Grid.Col>
            </Grid>
            <Group gap="md" align="flex-end" wrap="wrap">
              <SegmentedControl
                value={dateMode}
                onChange={(v) => {
                  const mode = v as DateMode;
                  setDateMode(mode);
                  setCalOpen(false);
                  // 切到指定日期时默认带上今天，避免空值
                  if (mode === "date" && !customDate) setCustomDate(todayStr());
                }}
                data={[
                  { label: "全部点击", value: "all" },
                  { label: "今日点击", value: "today" },
                  { label: "指定日期", value: "date" },
                ]}
              />
              {dateMode === "date" && (
                <Popover
                  opened={calOpen}
                  onChange={setCalOpen}
                  position="bottom-start"
                  shadow="md"
                  radius="md"
                  withinPortal
                >
                  <Popover.Target>
                    <TextInput
                      label="点击日期"
                      w={190}
                      value={customDate}
                      readOnly
                      leftSection={<CalendarDays size={15} />}
                      styles={{ input: { cursor: "pointer" } }}
                      onClick={() => setCalOpen((open) => !open)}
                    />
                  </Popover.Target>
                  <Popover.Dropdown p="xs">
                    <MonthCalendar
                      value={customDate}
                      max={todayStr()}
                      onChange={(next) => {
                        setCustomDate(next);
                        setCalOpen(false);
                      }}
                    />
                  </Popover.Dropdown>
                </Popover>
              )}
            </Group>
            <Group gap="lg" wrap="wrap">
              <Switch
                label="按 trackId 去重"
                description="同一设备多次点击只算一次（保留最新）"
                checked={dedupe}
                onChange={(e) => setDedupe(e.currentTarget.checked)}
              />
              <Switch
                label="试运行"
                description="只组装回传 URL 不发送"
                checked={dryRun}
                onChange={(e) => setDryRun(e.currentTarget.checked)}
              />
            </Group>
            {funnelInvalid && (
              <Alert color="yellow" variant="light" title="数量校验">
                数量必须满足 激活 ≥ 注册 ≥ 付费
              </Alert>
            )}
            {!dbReady && (
              <Alert color="yellow" variant="light" title="数据源未就绪">
                请先填写主机 / 用户名 / 数据库（可点击「测试连接」确认）
              </Alert>
            )}
            {runError && (
              <Alert color="red" variant="light" title="回传失败" withCloseButton onClose={() => setRunError(null)}>
                {runError}
              </Alert>
            )}
            <Group gap="sm" wrap="wrap">
              <Button
                variant="default"
                className="ops-btn-secondary"
                leftSection={checking ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
                loading={checking}
                onClick={handleCheck}
              >
                查询设备
              </Button>
              <Button
                leftSection={running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                disabled={!canRun}
                onClick={handleRun}
                variant="filled"
                color="blue"
              >
                {dryRun ? "试运行（不发送）" : "开始回传"}
              </Button>
              {running && (
                <Text size="sm" c="var(--color-text-muted)">
                  {progress.message}
                </Text>
              )}
            </Group>
            {!running && !checkEnough && dbReady && !funnelInvalid && !dateInvalid && (
              <Text size="xs" c="dimmed">
                先点「查询设备」按当前条件只读查库；设备充足后才能回传，设备不足不会发送。
              </Text>
            )}
            {checkError && (
              <Alert color="red" variant="light" title="查询失败" withCloseButton onClose={() => setCheckError(null)}>
                {checkError}
              </Alert>
            )}
            {checkResult && !checkError && (
              <Alert
                color={checkResult.enough ? "teal" : "yellow"}
                variant="light"
                title={
                  <Group gap="xs">
                    <span>{checkResult.enough ? "设备充足" : "设备不足，不会回传"}</span>
                    <Badge color={checkResult.enough ? "teal" : "yellow"} variant="filled" size="sm">
                      {checkResult.enough ? "可回传" : `差 ${checkResult.shortfall} 个`}
                    </Badge>
                  </Group>
                }
              >
                <Stack gap={4} mt={4}>
                  <CheckRow label="命中可用点击" value={`${checkResult.click_rows} 条`} />
                  <CheckRow label="可回传设备" value={`${checkResult.devices} 个`} />
                  <CheckRow
                    label="需求"
                    value={`激活 ${checkResult.activate} / 注册 ${checkResult.register} / 付费 ${checkResult.pay}`}
                  />
                  <CheckRow label="点击表" value={checkResult.resolved_table} />
                  <CheckRow label="advertiserId" value={checkResult.advertiser_id || "—"} />
                  <CheckRow
                    label="点击时间"
                    value={
                      checkResult.click_time_max
                        ? `${checkResult.click_time_min} ~ ${checkResult.click_time_max}`
                        : "—"
                    }
                  />
                </Stack>
                <Text size="xs" c="dimmed" mt={8}>
                  {checkResult.enough
                    ? "查询只读，未发送任何回传；可直接开始回传。"
                    : "可放宽日期范围、关闭按 trackId 去重，或把激活数调到不超过可回传设备数后重新查询。"}
                </Text>
              </Alert>
            )}

            {running && (
              <Paper p="sm" radius="md">
                <Stack gap={6}>
                  <Group justify="space-between" gap="sm">
                    <Text size="sm" c="var(--color-text)">
                      {progress.message || "处理中..."}
                    </Text>
                    <Text size="sm" fw={600} c="var(--color-primary-hover)">
                      {progress.percent}%
                    </Text>
                  </Group>
                  <Progress value={progress.percent} />
                  {progress.total > 0 && (
                    <Text size="xs" c="var(--color-text-muted)">
                      进度 {progress.current}/{progress.total}
                    </Text>
                  )}
                </Stack>
              </Paper>
            )}

            {lines.length > 0 && (
              <Box
                ref={logBoxRef}
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  fontFamily: "var(--font-monospace, monospace)",
                  fontSize: 11,
                  lineHeight: 1.6,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md, 8px)",
                  background: "var(--color-bg-subtle, rgba(0,0,0,0.04))",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {lines.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </Box>
            )}
          </Stack>
        </Paper>

        {summary && (
          <Paper p="md" radius="md">
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                {summary.dry_run && <Badge color="blue" variant="light">试运行（未发送）</Badge>}
                <Badge color="gray" variant="light">设备 {summary.devices} 个</Badge>
                <Badge color="gray" variant="light">共 {summary.total} 条</Badge>
                <Badge color="gray" variant="light">advertiserId={summary.advertiser_id}</Badge>
                {summary.click_time_ceiling && (
                  <Badge color="gray" variant="light">点击时间上限 {summary.click_time_ceiling}</Badge>
                )}
              </Group>
              <Group gap="lg" wrap="wrap">
                {summary.events.map((stat) => (
                  <Group key={stat.event} gap={6} wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {EVENT_LABELS[stat.event] ?? stat.event}
                    </Text>
                    {stat.dry_run > 0 && <Badge color="blue" variant="light">试运行 {stat.dry_run}</Badge>}
                    {stat.success > 0 && <Badge color="teal" variant="light">成功 {stat.success}</Badge>}
                    {stat.failed > 0 && <Badge color="red" variant="light">失败 {stat.failed}</Badge>}
                    {stat.unknown > 0 && <Badge color="yellow" variant="light">未知 {stat.unknown}</Badge>}
                    {stat.error > 0 && <Badge color="red" variant="light">异常 {stat.error}</Badge>}
                    {stat.success + stat.failed + stat.unknown + stat.error + stat.dry_run === 0 && (
                      <Badge color="gray" variant="light">未执行</Badge>
                    )}
                  </Group>
                ))}
              </Group>

              {summary.sample_urls.length > 0 && (
                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    试运行样例 URL
                  </Text>
                  {summary.sample_urls.map((url, idx) => (
                    <Text key={idx} size="xs" c="var(--color-text-muted)" style={{ wordBreak: "break-all" }}>
                      {url}
                    </Text>
                  ))}
                </Box>
              )}

              {summary.details.some((d) => d.outcome === "failed" || d.outcome === "error" || d.outcome === "unknown") && (
                <Box
                  style={{
                    maxHeight: 320,
                    overflowY: "auto",
                    fontSize: 12,
                    lineHeight: 1.7,
                  }}
                >
                  <Text size="sm" fw={600} mb={4}>
                    需要关注（失败 / 异常 / 未知）
                  </Text>
                  {summary.details
                    .filter((d) => d.outcome === "failed" || d.outcome === "error" || d.outcome === "unknown")
                    .map((d, idx) => (
                      <Text key={idx} size="xs" c="var(--color-text-muted)" style={{ wordBreak: "break-all" }}>
                        <Badge size="xs" color="gray" variant="light" mr={6}>
                          {EVENT_LABELS[d.event] ?? d.event}
                        </Badge>
                        <span style={{ color: `var(--mantine-color-${OUTCOME_COLOR[d.outcome] ?? "gray"}-6)` }}>
                          {d.outcome}
                        </span>
                        {" · "}
                        conv={d.conversion_id} · track={d.track_id}
                        {d.message ? ` · ${d.message}` : ""}
                      </Text>
                    ))}
                </Box>
              )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}
