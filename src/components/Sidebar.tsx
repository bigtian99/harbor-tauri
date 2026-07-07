import {
  Container, Upload, Rocket, Settings, GitBranch, History, Globe, GitMerge,
  ChevronLeft, ChevronRight, FileText, Zap
} from "lucide-react";
import type { TabType } from "../types";
import { isOpsTab } from "../opsNavigation";

interface SidebarProps {
  activeTab: TabType;
  sidebarCollapsed: boolean;
  opsMode: boolean;
  onTabChange: (tab: TabType) => void;
  onToggleCollapse: () => void;
}

export function Sidebar({ activeTab, sidebarCollapsed, opsMode, onTabChange, onToggleCollapse }: SidebarProps) {
  const navItems: { tab: TabType; icon: React.ReactNode; label: string }[] = [
    { tab: "upload", icon: <Upload size={18} />, label: "上传推送" },
    { tab: "push", icon: <Rocket size={18} />, label: "镜像推送" },
    { tab: "branch", icon: <GitBranch size={18} />, label: "分支打包" },
    { tab: "merge", icon: <GitMerge size={18} />, label: "分支合并" },
    { tab: "history", icon: <History size={18} />, label: "历史记录" },
    { tab: "landing", icon: <Globe size={18} />, label: "生成落地页" },
    { tab: "settlement", icon: <FileText size={18} />, label: "结算单" },
    { tab: "packSpeed", icon: <Zap size={18} />, label: "打包加速" },
  ];

  const visibleItems = opsMode ? navItems.filter((item) => isOpsTab(item.tab)) : navItems;

  return (
    <>
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <Container size={24} className="header-icon" />
          {!sidebarCollapsed && <h1>ShipForge</h1>}
        </div>

        <nav className="sidebar-nav">
          {visibleItems.map(({ tab, icon, label }) => (
            <button
              key={tab}
              className={`sidebar-item ${activeTab === tab ? "active" : ""}`}
              onClick={() => onTabChange(tab)}
              data-label={label}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                document.documentElement.style.setProperty('--tooltip-top', `${rect.top + rect.height / 2}px`);
              }}
            >
              {icon}
              {!sidebarCollapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
        {!opsMode && (
          <div className="sidebar-footer">
            <button
              className="sidebar-item settings-item"
              onClick={() => onTabChange("config")}
              data-label="设置"
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                document.documentElement.style.setProperty('--tooltip-top', `${rect.top + rect.height / 2}px`);
              }}
            >
              <Settings size={18} />
              {!sidebarCollapsed && <span>设置</span>}
            </button>
          </div>
        )}
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
