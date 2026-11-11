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
  Popover,
  Progress,
  SegmentedControl,
  Select,
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
  Loader2,
  Play,
  Search,
} from "lucide-react";

import type {
  HonorAccountInfo,
  HonorCheckParams,
  HonorDeviceCheckResult,
  HonorProgressPayload,
  HonorReportParams,
  HonorReportSummary,
} from "../types";
import { isTauriRuntime } from "../types";
import { PanelPageHeader } from "./PanelPageHeader";
import "../styles/ops-panel.css";

type DateMode = "today" | "date" | "all";

/** 记住上次选的投放账户，重开面板仍是同一账户 */
const HONOR_ACCOUNT_KEY = "jarporter.honor.accountPk";

type HonorProgress = {
  percent: number;
  message: string;
  current: number;
  total: number;
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
function CheckRow({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  /** warn：缺口这类要紧的数，加亮加粗，别跟普通明细糊在一起 */
  tone?: "normal" | "warn" | "ok" | "dim";
}) {
  const valueColor =
    tone === "warn" ? "#ffb020" : tone === "ok" ? "#2dd4a7" : tone === "dim" ? undefined : undefined;
  return (
    <Group justify="space-between" gap="md" wrap="nowrap">
      <Text size="xs" c={tone === "dim" ? "dimmed" : undefined} style={{ flexShrink: 0 }} fw={tone === "warn" ? 600 : undefined}>
        {label}
      </Text>
      <Text
        size="xs"
        fw={tone === "warn" || tone === "ok" ? 700 : undefined}
        c={valueColor}
        style={{ wordBreak: "break-all", textAlign: "right" }}
      >
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

export function HonorReportPanel() {
  // 投放账户：点击表只存 account_pk，必须先选账户才能查点击
  const [accounts, setAccounts] = useState<HonorAccountInfo[]>([]);
  const [accountPk, setAccountPk] = useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

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

  // 记住选择，重开面板沿用
  useEffect(() => {
    if (accountPk) window.localStorage.setItem(HONOR_ACCOUNT_KEY, accountPk);
  }, [accountPk]);

  // 进面板即拉账户列表；只有一个账户时自动选中，省一次点击
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    setAccountsLoading(true);
    setAccountsError(null);
    invoke<HonorAccountInfo[]>("honor_list_accounts", { db: {}, platform: "honor" })
      .then((list) => {
        if (disposed) return;
        setAccounts(list);
        const stored = window.localStorage.getItem(HONOR_ACCOUNT_KEY);
        const pick =
          list.find((a) => a.pk === stored)?.pk ??
          (list.length === 1 ? list[0].pk : null);
        setAccountPk((prev) => prev ?? pick);
      })
      .catch((e) => {
        if (!disposed) setAccountsError(String(e));
      })
      .finally(() => {
        if (!disposed) setAccountsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

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

  const funnelInvalid = activate < register || register < pay;
  const dateInvalid = dateMode === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(customDate.trim());

  // 预检结论只在参数未变时有效：数量/日期/去重一旦改动必须重新查询，防止拿旧结论发送
  function checkSignature() {
    return JSON.stringify({
      accountPk,
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
  const canRun = Boolean(accountPk) && !funnelInvalid && !dateInvalid && !running && checkEnough;

  /** 设备预检：按当前数量/日期/去重口径只读查库，不发送任何回传 */
  async function handleCheck() {
    if (!isTauriRuntime()) {
      setCheckError("请在桌面端查询设备");
      return;
    }
    if (!accountPk) {
      setCheckError("请先选择投放账户");
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
        db: {},
        account_pk: accountPk,
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
      db: {},
      account_pk: accountPk,
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
            <Text size="sm" fw={600}>
              回传计划
            </Text>
            <Text size="xs" c="dimmed">
              按脚本口径批量回传：三个数量共用同一批设备（激活 ⊇ 注册 ⊇ 付费 取前缀子集）；
              设备按 oaid 去重（同一台设备只回传一次，取最新点击），复用该条点击的
              trackId / oaid / advertiserId；conversionTime 从点击时间上限 +1s 起步逐条递增；
              付费事件的金额与订单号由系统内部生成。先「查询设备」确认有数据再回传，没数据会提示且不会发送。
            </Text>
            <Select
              label="投放账户（media_account）"
              description="点击表按 account_pk 归档，必须先选账户再查点击"
              placeholder={accountsLoading ? "读取账户中..." : "选择荣耀投放账户"}
              data={accounts.map((a) => ({
                value: a.pk,
                label: `${a.account_id} · ${a.account_name}${
                  a.account_alias ? `（${a.account_alias}）` : ""
                }（可回传 ${a.click_rows}）`,
              }))}
              value={accountPk}
              onChange={setAccountPk}
              disabled={accountsLoading || accounts.length === 0}
              searchable
              clearable={false}
              nothingFoundMessage={accountsLoading ? "读取中..." : "没有可用的荣耀账户"}
            />
            {accountsError && (
              <Alert color="red" variant="light" title="读取投放账户失败" withCloseButton onClose={() => setAccountsError(null)}>
                {accountsError}
              </Alert>
            )}
            {!accountsLoading && !accountsError && accounts.length === 0 && (
              <Alert color="yellow" variant="light" title="没有可用账户">
                投流库 media_account 里没有 platform=honor 的账户，请先在投放系统里同步荣耀账户。
              </Alert>
            )}
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
                label="按设备去重（oaid）"
                description="同一台设备多次点击只回传一次（保留最新那条）"
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
            {!running && !checkEnough && !funnelInvalid && !dateInvalid && (
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
                className={
                  checkResult.enough ? "honor-check-alert is-ok" : "honor-check-alert is-short"
                }
                color={checkResult.enough ? "teal" : "yellow"}
                variant="light"
                title={
                  <Group gap="xs">
                    <span>{checkResult.enough ? "设备充足" : "设备不足，不会回传"}</span>
                    <Badge
                      className={checkResult.enough ? "honor-badge-ok" : "honor-badge-short"}
                      variant="filled"
                      size="md"
                      radius="sm"
                    >
                      {checkResult.enough ? "可回传" : `缺 ${checkResult.shortfall} 个`}
                    </Badge>
                  </Group>
                }
              >
                <Stack gap={4} mt={4}>
                  <CheckRow label="命中可用点击" value={`${checkResult.click_rows} 条`} />
                  <CheckRow
                    label="可回传设备"
                    value={`${checkResult.devices} 个`}
                    tone={checkResult.enough ? "ok" : "dim"}
                  />
                  {checkResult.already_reported > 0 && (
                    <CheckRow
                      label="今日已回传"
                      value={`${checkResult.already_reported} 台（已排除，不会重复上报）`}
                      tone="warn"
                    />
                  )}
                  {!checkResult.enough && (
                    <CheckRow
                      label="缺口"
                      value={`还差 ${checkResult.shortfall} 个（需 ${checkResult.activate}，现有 ${checkResult.devices}）`}
                      tone="warn"
                    />
                  )}
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
                    : "可放宽日期范围、关闭按设备去重，或把激活数调到不超过可回传设备数后重新查询。"}
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
                {summary.already_reported > 0 && (
                  <Badge color="yellow" variant="light">
                    今日已回传 {summary.already_reported} 台（已跳过）
                  </Badge>
                )}
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
