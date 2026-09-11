import type { ReactNode } from "react";

export interface PanelPageHeaderProps {
  /** 等宽眉标，如 JAR / DIST → DOCKER → HARBOR */
  eyebrow: string;
  title: string;
  sub?: string;
  /** 右侧附加区（步骤条、操作按钮等） */
  children?: ReactNode;
}

/** 主面板页头：与「上传推送」同款眉标 + 大标题 + 副文案 */
export function PanelPageHeader({
  eyebrow,
  title,
  sub,
  children,
}: PanelPageHeaderProps) {
  return (
    <header className="panel-head">
      <div className="panel-head-text">
        <span className="panel-eyebrow">{eyebrow}</span>
        <h1 className="panel-title">{title}</h1>
        {sub ? <p className="panel-sub">{sub}</p> : null}
      </div>
      {children ? <div className="panel-head-actions">{children}</div> : null}
    </header>
  );
}
