import { Box } from "@mantine/core";

export function TemplatePreviewCard({
  iframeSrc,
  animationClass,
  isCenter,
  onClick,
}: {
  iframeSrc: string;
  animationClass: string;
  isCenter: boolean;
  onClick: () => void;
}) {
  const cardWidth = isCenter ? 72 : 48;
  const cardHeight = isCenter ? 88 : 64;
  const wrapperScale = isCenter ? 0.192 : 0.128;

  return (
    <Box
      onClick={onClick}
      title="点击放大预览"
      style={{
        position: "relative",
        borderRadius: 8,
        border: `1px solid ${isCenter ? "color-mix(in srgb, var(--color-primary) 60%, transparent)" : "var(--color-border)"}`,
        overflow: "hidden",
        cursor: "pointer",
        background: "var(--color-preview-paper)",
        flexShrink: 0,
        width: cardWidth,
        height: cardHeight,
        opacity: isCenter ? 1 : 0.5,
        transform: isCenter ? "scale(1)" : "scale(0.92)",
        boxShadow: isCenter ? "0 4px 20px var(--color-primary-muted)" : "none",
        zIndex: isCenter ? 2 : 1,
        transition: "all 0.4s cubic-bezier(0.25,0.46,0.45,0.94)",
        animation: animationClass === "animating-left"
          ? "slideInFromLeft 0.35s cubic-bezier(0.25,0.46,0.45,0.94) forwards"
          : animationClass === "animating-right"
            ? "slideInFromRight 0.35s cubic-bezier(0.25,0.46,0.45,0.94) forwards"
            : "none",
      }}
      onMouseEnter={(e) => {
        if (isCenter) {
          e.currentTarget.style.borderColor = "color-mix(in srgb, var(--color-primary) 80%, transparent)";
          e.currentTarget.style.boxShadow = "0 6px 24px var(--color-primary-muted)";
          e.currentTarget.style.transform = "scale(1.08)";
        } else {
          e.currentTarget.style.opacity = "0.75";
          e.currentTarget.style.transform = "scale(0.96)";
        }
      }}
      onMouseLeave={(e) => {
        if (isCenter) {
          e.currentTarget.style.borderColor = "color-mix(in srgb, var(--color-primary) 60%, transparent)";
          e.currentTarget.style.boxShadow = "0 4px 20px var(--color-primary-muted)";
          e.currentTarget.style.transform = "scale(1)";
        } else {
          e.currentTarget.style.opacity = "0.5";
          e.currentTarget.style.transform = "scale(0.92)";
        }
      }}
    >
      <Box
        style={{
          width: 375,
          height: 812,
          transform: `scale(${wrapperScale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      >
        <iframe
          src={iframeSrc}
          style={{ width: 375, height: 812, border: "none", pointerEvents: "none" }}
          loading="lazy"
        />
      </Box>
    </Box>
  );
}
