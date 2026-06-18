import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./TemplateCarousel.css";

interface TemplateCarouselProps {
  images: string[];
  alt?: string;
}

export function TemplateCarousel({ images, alt = "" }: TemplateCarouselProps) {
  const [current, setCurrent] = useState(0);
  const total = images.length;

  if (total === 0) {
    return <div className="tc-empty">无预览</div>;
  }

  return (
    <div className="tc-carousel">
      <button
        className="tc-arrow tc-arrow-left"
        onClick={(e) => { e.stopPropagation(); setCurrent((c) => (c - 1 + total) % total); }}
        title="上一个模板"
      >
        <ChevronLeft size={10} />
      </button>
      <div className="tc-viewport">
        <img src={images[current]} alt={`${alt} ${current + 1}`} className="tc-img" />
      </div>
      <button
        className="tc-arrow tc-arrow-right"
        onClick={(e) => { e.stopPropagation(); setCurrent((c) => (c + 1) % total); }}
        title="下一个模板"
      >
        <ChevronRight size={10} />
      </button>
      {total > 1 && (
        <div className="tc-dots">
          {images.map((_, i) => (
            <span
              key={i}
              className={`tc-dot ${i === current ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
