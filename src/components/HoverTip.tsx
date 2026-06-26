import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface HoverTipProps {
  tip: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function HoverTip({ tip, children, className, style }: HoverTipProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const show = useCallback(() => {
    if (!tip) return;
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxWidth = Math.min(520, window.innerWidth - 32);
    setCoords({
      top: rect.top - 8,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - maxWidth - 16)),
    });
    setVisible(true);
  }, [tip]);

  const hide = useCallback(() => setVisible(false), []);

  if (!tip) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <>
      <div
        ref={anchorRef}
        className={className}
        style={style}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {children}
      </div>
      {visible && createPortal(
        <div
          className="hover-tip-popup"
          style={{ top: coords.top, left: coords.left }}
          role="tooltip"
        >
          {tip}
        </div>,
        document.body,
      )}
    </>
  );
}
