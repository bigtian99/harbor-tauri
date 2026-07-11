import type { ReactNode } from "react";
import { Group, ActionIcon, Text, Box } from "@mantine/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LandingPageResult } from "../../types";
import { TemplatePreviewCard } from "./TemplatePreviewCard";
import { getCarouselIndices } from "./utils";

interface TemplateCarouselProps {
  genResult: LandingPageResult;
  currentTemplateIndex: number;
  animationClass?: string;
  titleBase: string;
  iframeSrc: (idx: number) => string;
  onSwitch: (direction: "prev" | "next") => void;
  onOpenPreview: (src: string, title: string) => void;
  /** 未生成成功时的占位内容 */
  placeholder?: ReactNode;
}

/** 模板 iframe 轮播（多模板 prev/center/next） */
export function TemplateCarousel({
  genResult,
  currentTemplateIndex,
  animationClass = "",
  titleBase,
  iframeSrc,
  onSwitch,
  onOpenPreview,
  placeholder,
}: TemplateCarouselProps) {
  if (genResult.status !== "success") {
    return (
      placeholder ?? (
        <Box
          w={56}
          h={72}
          style={{
            borderRadius: 6,
            border: "1px solid rgba(94,234,212,0.08)",
            background: "rgba(15,52,96,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text size="sm" c="dimmed">
            {(titleBase || "?").charAt(0)}
          </Text>
        </Box>
      )
    );
  }

  const hasMultiple = genResult.template_dirs && genResult.template_dirs.length > 1;
  const total = genResult.template_dirs.length;
  const indices = getCarouselIndices(currentTemplateIndex, total);

  return (
    <Group
      gap={4}
      justify="center"
      wrap="nowrap"
      style={{ height: 104, position: "relative", transform: "translateX(-28px)" }}
    >
      {hasMultiple && (
        <ActionIcon
          variant="subtle"
          color="teal"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onSwitch("prev");
          }}
          title="上一个模板"
        >
          <ChevronLeft size={14} />
        </ActionIcon>
      )}

      {total === 1 ? (
        (() => {
          const s = iframeSrc(0);
          return (
            <TemplatePreviewCard
              iframeSrc={s}
              animationClass=""
              isCenter={true}
              onClick={() => onOpenPreview(s, `${titleBase} - 模板`)}
            />
          );
        })()
      ) : (
        indices.map((tempIdx, pos) => {
          const isCenter = pos === 1 || total < 3;
          const s = iframeSrc(tempIdx);
          return (
            <TemplatePreviewCard
              key={tempIdx}
              iframeSrc={s}
              animationClass={isCenter ? animationClass : ""}
              isCenter={isCenter}
              onClick={() => onOpenPreview(s, `${titleBase} - 模板${tempIdx + 1}`)}
            />
          );
        })
      )}

      {hasMultiple && (
        <ActionIcon
          variant="subtle"
          color="teal"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onSwitch("next");
          }}
          title="下一个模板"
        >
          <ChevronRight size={14} />
        </ActionIcon>
      )}

      {hasMultiple && (
        <Text
          size="xs"
          c="dimmed"
          style={{
            position: "absolute",
            bottom: -10,
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
          }}
        >
          {currentTemplateIndex + 1}/{total}
        </Text>
      )}
    </Group>
  );
}
