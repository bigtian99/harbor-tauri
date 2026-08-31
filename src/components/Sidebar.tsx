import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  AppShell,
  Box,
  Group,
  NavLink,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  Upload,
  Rocket,
  Settings,
  GitBranch,
  History,
  Globe,
  GitMerge,
  ChevronLeft,
  ChevronRight,
  FileText,
  Zap,
  ScrollText,
  Shield,
  Coffee,
  Code2,
} from "lucide-react";
import type { TabType } from "../types";
import { isOpsTab } from "../opsNavigation";
import { BaotaIcon, BrandMark, KubeSphereIcon } from "./icons/BrandIcons";

interface SidebarProps {
  activeTab: TabType;
  sidebarCollapsed: boolean;
  opsMode: boolean;
  onTabChange: (tab: TabType) => void;
  onToggleCollapse: () => void;
  onOpenLog: () => void;
}

const SIDEBAR_W = 220;
const SIDEBAR_W_COLLAPSED = 56;

const navStyles = {
  root: {
    borderRadius: "var(--radius-md)",
    color: "var(--color-text-muted)",
    "--nav-icon-opacity": "0.55",
    border: "none",
    boxShadow: "none",
    "&[data-active]": {
      background: "var(--color-primary-muted)",
      color: "var(--color-primary-hover)",
      border: "none",
      borderLeft: "none",
      boxShadow: "none",
      "--nav-icon-opacity": "1",
      fontWeight: 600,
    },
    "&:hover:not([data-active])": {
      background: "rgba(255, 255, 255, 0.04)",
      color: "var(--color-text)",
      "--nav-icon-opacity": "0.85",
    },
  },
  label: { fontSize: 13, fontWeight: 500 },
  section: {
    color: "inherit",
    opacity: "var(--nav-icon-opacity)" as unknown as number,
    transition: "opacity 0.15s ease",
  },
} as const;

const BT_TABS = ["btJava", "btPhp"] as const satisfies readonly TabType[];

const btSubItems: { tab: (typeof BT_TABS)[number]; icon: ReactNode; label: string }[] = [
  { tab: "btJava", icon: <Coffee size={16} />, label: "Java 项目" },
  { tab: "btPhp", icon: <Code2 size={16} />, label: "PHP 项目" },
];

function isBtTab(tab: TabType): tab is (typeof BT_TABS)[number] {
  return (BT_TABS as readonly TabType[]).includes(tab);
}

type NavItem = { tab: TabType; icon: ReactNode; label: string };

function NavItemLink({
  item,
  activeTab,
  collapsed,
  onTabChange,
}: {
  item: NavItem;
  activeTab: TabType;
  collapsed: boolean;
  onTabChange: (tab: TabType) => void;
}) {
  return (
    <Tooltip label={item.label} position="right" withArrow openDelay={200} disabled={!collapsed}>
      <NavLink
        className="sidebar-nav-link"
        label={item.label}
        leftSection={item.icon}
        active={activeTab === item.tab}
        onClick={() => onTabChange(item.tab)}
        color="blue"
        variant="light"
        styles={navStyles}
      />
    </Tooltip>
  );
}

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  return (
    <Box className="sidebar-section-wrap" data-collapsed={collapsed || undefined}>
      <Text
        className="sidebar-section-label"
        px="sm"
        pt={10}
        pb={4}
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          opacity: 0.85,
          userSelect: "none",
        }}
      >
        {label}
      </Text>
      <Box className="sidebar-section-divider" mx="auto" my={6} />
    </Box>
  );
}

export function Sidebar({
  activeTab,
  sidebarCollapsed,
  opsMode,
  onTabChange,
  onToggleCollapse,
  onOpenLog,
}: SidebarProps) {
  const buildItems: NavItem[] = [
    { tab: "upload", icon: <Upload size={18} />, label: "上传推送" },
    { tab: "push", icon: <Rocket size={18} />, label: "镜像推送" },
    { tab: "branch", icon: <GitBranch size={18} />, label: "分支打包" },
    { tab: "merge", icon: <GitMerge size={18} />, label: "分支合并" },
    { tab: "history", icon: <History size={18} />, label: "历史记录" },
  ];
  const opsItems: NavItem[] = [
    { tab: "landing", icon: <Globe size={18} />, label: "生成落地页" },
    { tab: "privacy", icon: <Shield size={18} />, label: "隐私协议" },
    { tab: "settlement", icon: <FileText size={18} />, label: "结算单" },
    { tab: "packSpeed", icon: <Zap size={18} />, label: "打包加速" },
  ];
  const publishItems: NavItem[] = [
    { tab: "ksPublish", icon: <KubeSphereIcon size={18} />, label: "KubeSphere 发布" },
  ];

  const filterOps = (items: NavItem[]) =>
    opsMode ? items.filter((item) => isOpsTab(item.tab)) : items;

  const itemsBuild = filterOps(buildItems);
  const itemsOps = filterOps(opsItems);
  const itemsPublish = filterOps(publishItems);
  const showBtGroup = !opsMode;
  const isBtActive = isBtTab(activeTab);

  const [btOpened, setBtOpened] = useState(() => isBtActive);
  const [btFlyout, setBtFlyout] = useState(false);

  useEffect(() => {
    if (isBtActive) setBtOpened(true);
  }, [isBtActive]);

  useEffect(() => {
    if (!sidebarCollapsed) setBtFlyout(false);
  }, [sidebarCollapsed]);

  // 折叠态宝塔 flyout：悬浮展开，鼠标在目标与弹层之间移动不闪关
  const btFlyoutCloseTimer = useRef<number | null>(null);
  const cancelBtFlyoutClose = () => {
    if (btFlyoutCloseTimer.current !== null) {
      window.clearTimeout(btFlyoutCloseTimer.current);
      btFlyoutCloseTimer.current = null;
    }
  };
  const scheduleBtFlyoutClose = () => {
    cancelBtFlyoutClose();
    btFlyoutCloseTimer.current = window.setTimeout(() => setBtFlyout(false), 140);
  };
  const openBtFlyout = () => {
    cancelBtFlyoutClose();
    setBtFlyout(true);
  };
  useEffect(() => cancelBtFlyoutClose, []);

  const showBuild = itemsBuild.length > 0 || showBtGroup;
  const showOps = itemsOps.length > 0;
  const showPublish = itemsPublish.length > 0;

  const btChildren = btSubItems.map(({ tab, icon, label }) => (
    <NavLink
      key={tab}
      className="sidebar-nav-link"
      label={label}
      leftSection={icon}
      active={activeTab === tab}
      onClick={() => {
        cancelBtFlyoutClose();
        setBtFlyout(false);
        onTabChange(tab);
      }}
      color="blue"
      variant="light"
      styles={navStyles}
    />
  ));

  return (
    <>
      <AppShell.Navbar
        p={0}
        className="app-sidebar"
        data-collapsed={sidebarCollapsed || undefined}
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-bg-surface) 82%, #1a3a6a) 0%, var(--color-bg-surface) 40%)",
          borderRight: "1px solid var(--color-border-strong)",
        }}
      >
        {/* 骑在侧栏右边线上的折叠钮 */}
        <ActionIcon
          className="sidebar-toggle"
          variant="default"
          size={0}
          onClick={onToggleCollapse}
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </ActionIcon>

        {/* 品牌 */}
        <AppShell.Section
          className="sidebar-brand-section"
          px={sidebarCollapsed ? 0 : 14}
          py={14}
          style={{
            borderBottom: "1px solid var(--color-border)",
            minHeight: 56,
          }}
        >
          <Group
            gap={10}
            wrap="nowrap"
            justify={sidebarCollapsed ? "center" : "flex-start"}
            align="center"
            w={sidebarCollapsed ? "100%" : undefined}
          >
            <BrandMark size={28} style={{ flexShrink: 0 }} />
            <Box className="sidebar-brand-text">
              <Text fw={700} style={{ color: "var(--color-text)", letterSpacing: "0.04em", fontSize: 15 }}>
                码头工坊
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: "var(--color-text-muted)",
                  opacity: 0.75,
                  marginTop: 3,
                }}
              >
                构建 · 发布 · 运营
              </Text>
            </Box>
          </Group>
        </AppShell.Section>

        {/* 导航 */}
        <AppShell.Section grow component={ScrollArea} px={8} py={8} type="scroll" offsetScrollbars={false}>
          <Stack gap={2}>
            {showBuild && (
              <Box>
                <SectionLabel label="构建" collapsed={sidebarCollapsed} />
                {itemsBuild.map((item) => (
                  <NavItemLink
                    key={item.tab}
                    item={item}
                    activeTab={activeTab}
                    collapsed={sidebarCollapsed}
                    onTabChange={onTabChange}
                  />
                ))}

                {showBtGroup &&
                  (sidebarCollapsed ? (
                    <Popover
                      opened={btFlyout}
                      onChange={setBtFlyout}
                      position="right-start"
                      withArrow
                      shadow="md"
                      withinPortal
                    >
                      <Popover.Target>
                        <Tooltip label="宝塔" position="right" withArrow openDelay={200} disabled={btFlyout}>
                          <NavLink
                            className={`sidebar-nav-link${isBtActive ? " sidebar-nav-link--section-on" : ""}`}
                            leftSection={<BaotaIcon size={18} />}
                            active={false}
                            onMouseEnter={openBtFlyout}
                            onMouseLeave={scheduleBtFlyoutClose}
                            onClick={openBtFlyout}
                            color="gray"
                            variant="subtle"
                            styles={navStyles}
                            aria-label="宝塔"
                            aria-current={isBtActive ? "true" : undefined}
                            aria-expanded={btFlyout}
                          />
                        </Tooltip>
                      </Popover.Target>
                      <Popover.Dropdown
                        p={6}
                        onMouseEnter={cancelBtFlyoutClose}
                        onMouseLeave={scheduleBtFlyoutClose}
                        style={{
                          background: "var(--color-bg-surface)",
                          border: "1px solid var(--color-border)",
                          minWidth: 160,
                        }}
                      >
                        <Text
                          px="sm"
                          pb={4}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            color: "var(--color-text-muted)",
                            userSelect: "none",
                          }}
                        >
                          宝塔
                        </Text>
                        <Stack gap={2}>{btChildren}</Stack>
                      </Popover.Dropdown>
                    </Popover>
                  ) : (
                    <NavLink
                      className="sidebar-nav-group"
                      label="宝塔"
                      leftSection={<BaotaIcon size={18} />}
                      active={false}
                      opened={btOpened}
                      onChange={setBtOpened}
                      color="gray"
                      variant="subtle"
                      styles={navStyles}
                      childrenOffset={16}
                    >
                      {btChildren}
                    </NavLink>
                  ))}
              </Box>
            )}

            {showOps && (
              <Box>
                <SectionLabel label="运营" collapsed={sidebarCollapsed} />
                {itemsOps.map((item) => (
                  <NavItemLink
                    key={item.tab}
                    item={item}
                    activeTab={activeTab}
                    collapsed={sidebarCollapsed}
                    onTabChange={onTabChange}
                  />
                ))}
              </Box>
            )}

            {showPublish && (
              <Box>
                <SectionLabel label="发布" collapsed={sidebarCollapsed} />
                {itemsPublish.map((item) => (
                  <NavItemLink
                    key={item.tab}
                    item={item}
                    activeTab={activeTab}
                    collapsed={sidebarCollapsed}
                    onTabChange={onTabChange}
                  />
                ))}
              </Box>
            )}
          </Stack>
        </AppShell.Section>

        {/* 底栏 */}
        {!opsMode && (
          <AppShell.Section
            px={8}
            py={10}
            style={{
              borderTop: "1px solid var(--color-border)",
              background: "rgba(0, 0, 0, 0.18)",
            }}
          >
            <Stack gap={2}>
              <Tooltip label="系统日志" position="right" withArrow disabled={!sidebarCollapsed}>
                <NavLink
                  className="sidebar-nav-link"
                  label="系统日志"
                  leftSection={<ScrollText size={18} />}
                  onClick={onOpenLog}
                  color="gray"
                  variant="subtle"
                  styles={navStyles}
                  aria-label="系统日志"
                />
              </Tooltip>
              <NavItemLink
                item={{ tab: "config", icon: <Settings size={18} />, label: "设置" }}
                activeTab={activeTab}
                collapsed={sidebarCollapsed}
                onTabChange={onTabChange}
              />
            </Stack>
          </AppShell.Section>
        )}
      </AppShell.Navbar>
    </>
  );
}

/** AppShell 根布局用的 navbar 宽度配置 */
export function getAppShellNavbarConfig(collapsed: boolean) {
  return {
    width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W,
    breakpoint: "xs" as const,
  };
}
