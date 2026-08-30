import { useEffect, useState, type ReactNode } from "react";
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
  Container,
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
import { BaotaIcon, KubeSphereIcon } from "./icons/BrandIcons";

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
  const link = (
    <NavLink
      className="sidebar-nav-link"
      label={collapsed ? undefined : item.label}
      leftSection={item.icon}
      active={activeTab === item.tab}
      onClick={() => onTabChange(item.tab)}
      color="blue"
      variant="light"
      styles={navStyles}
    />
  );
  if (!collapsed) return link;
  return (
    <Tooltip label={item.label} position="right" withArrow openDelay={200}>
      {link}
    </Tooltip>
  );
}

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <Box
        mx="auto"
        my={6}
        style={{
          width: 14,
          height: 1,
          background: "var(--color-border-strong)",
          opacity: 0.8,
        }}
      />
    );
  }
  return (
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
          >
            <Box
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "linear-gradient(135deg, var(--color-primary-muted), var(--color-accent-muted))",
                boxShadow: "var(--glow-primary)",
                flexShrink: 0,
              }}
            >
              <Container size={16} color="var(--color-primary-hover)" strokeWidth={2.25} />
            </Box>
            {!sidebarCollapsed && (
              <Box style={{ minWidth: 0, lineHeight: 1.15 }}>
                <Text fw={700} style={{ color: "var(--color-text)", letterSpacing: "0.06em", fontSize: 15 }}>
                  ShipForge
                </Text>
                <Text
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--color-text-muted)",
                    opacity: 0.75,
                    marginTop: 3,
                  }}
                >
                  Harbor · Build
                </Text>
              </Box>
            )}
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
                            onClick={() => setBtFlyout((o) => !o)}
                            color="gray"
                            variant="subtle"
                            styles={navStyles}
                            aria-label="宝塔"
                            aria-current={isBtActive ? "true" : undefined}
                          />
                        </Tooltip>
                      </Popover.Target>
                      <Popover.Dropdown
                        p={6}
                        style={{
                          background: "var(--color-bg-surface)",
                          border: "1px solid var(--color-border)",
                          minWidth: 160,
                        }}
                      >
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
              {sidebarCollapsed ? (
                <Tooltip label="系统日志" position="right" withArrow>
                  <NavLink
                    className="sidebar-nav-link"
                    leftSection={<ScrollText size={18} />}
                    onClick={onOpenLog}
                    color="gray"
                    variant="subtle"
                    styles={navStyles}
                    aria-label="系统日志"
                  />
                </Tooltip>
              ) : (
                <NavLink
                  className="sidebar-nav-link"
                  label="系统日志"
                  leftSection={<ScrollText size={18} />}
                  onClick={onOpenLog}
                  color="gray"
                  variant="subtle"
                  styles={navStyles}
                />
              )}
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
