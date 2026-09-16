import {
  Container, Globe, ChevronLeft, ChevronRight, FileText, Zap, Shield, ScrollText, Settings,
} from "lucide-react";
import type { TabType } from "../types";

interface SidebarProps {
  activeTab: TabType;
  sidebarCollapsed: boolean;
  onTabChange: (tab: TabType) => void;
  onToggleCollapse: () => void;
  onOpenLog: () => void;
}

export function Sidebar({ activeTab, sidebarCollapsed, onTabChange, onToggleCollapse, onOpenLog }: SidebarProps) {
  const navItems: { tab: TabType; icon: React.ReactNode; label: string }[] = [
    { tab: "landing", icon: <Globe size={18} />, label: "生成落地页" },
    { tab: "privacy", icon: <Shield size={18} />, label: "隐私协议" },
    { tab: "settlement", icon: <FileText size={18} />, label: "结算单" },
    { tab: "packSpeed", icon: <Zap size={18} />, label: "打包加速" },
  ];

  const setTooltipTop = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    document.documentElement.style.setProperty("--tooltip-top", `${rect.top + rect.height / 2}px`);
  };

  const renderNavItem = ({ tab, icon, label }: { tab: TabType; icon: React.ReactNode; label: string }) => (
    <button
      key={tab}
      className={`sidebar-item ${activeTab === tab ? "active" : ""}`}
      onClick={() => onTabChange(tab)}
      data-label={label}
      onMouseEnter={setTooltipTop}
    >
      {icon}
      {!sidebarCollapsed && <span>{label}</span>}
    </button>
  );

  return (
    <>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <Container size={24} className="header-icon" />
          {!sidebarCollapsed && <h1>ShipForge</h1>}
        </div>

        <nav className="sidebar-nav">
          {navItems.map(renderNavItem)}
        </nav>

        <div className="sidebar-footer">
          <button
            className="sidebar-item"
            onClick={onOpenLog}
            data-label="系统日志"
            onMouseEnter={setTooltipTop}
          >
            <ScrollText size={18} />
            {!sidebarCollapsed && <span>系统日志</span>}
          </button>
          <button
            className={`sidebar-item ${activeTab === "config" ? "active" : ""}`}
            onClick={() => onTabChange("config")}
            data-label="设置"
            onMouseEnter={setTooltipTop}
          >
            <Settings size={18} />
            {!sidebarCollapsed && <span>设置</span>}
          </button>
        </div>
      </aside>

      <button
        className="sidebar-toggle"
        onClick={onToggleCollapse}
      >
        {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </>
  );
}
