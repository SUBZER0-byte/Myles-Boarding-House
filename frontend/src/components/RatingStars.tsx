import { useState } from "react";
import { Star } from "lucide-react";

interface RatingStarsProps {
  value: number;
  size?: number;
  colorClass?: string;
  emptyClass?: string;
  onChange?: (value: number) => void;
}

export function RatingStars({
  value,
  size = 16,
  colorClass = "fill-warning text-warning",
  emptyClass = "text-muted-foreground",
  onChange,
}: RatingStarsProps) {
  const clampedValue = Math.max(0, Math.min(5, Number(value) || 0));
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const displayValue = hoveredValue ?? clampedValue;

  return (
    <div
      className="inline-flex items-center"
      role={onChange ? "group" : undefined}
      aria-label={`${clampedValue.toFixed(1)} out of 5 stars`}
      onMouseLeave={() => setHoveredValue(null)}
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const fillPercent = Math.max(0, Math.min(100, (displayValue - index) * 100));
        const star = (
          <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
            <Star size={size} className={`${emptyClass} transition-colors duration-150`} />
            <span
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${fillPercent}%`, transition: "width 150ms ease" }}
              aria-hidden="true"
            >
              <Star size={size} className={`${colorClass} max-w-none transition-colors duration-150`} />
            </span>
          </span>
        );

        if (!onChange) return <span key={index} className="inline-flex">{star}</span>;

        const lowerHalfValue = index + 0.5;
        const upperHalfValue = index + 1;
        return (
          <span
            key={index}
            className={`relative inline-flex transition-transform duration-150 ${hoveredValue != null && hoveredValue > index && hoveredValue <= index + 1 ? "scale-110" : ""}`}
            style={{ width: size, height: size }}
          >
            {star}
            <button
              type="button"
              className="absolute inset-y-0 left-0 w-1/2 cursor-pointer rounded-l-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => onChange(lowerHalfValue)}
              onMouseEnter={() => setHoveredValue(lowerHalfValue)}
              aria-label={`Rate ${lowerHalfValue} out of 5 stars`}
              aria-pressed={clampedValue === lowerHalfValue}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 w-1/2 cursor-pointer rounded-r-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => onChange(upperHalfValue)}
              onMouseEnter={() => setHoveredValue(upperHalfValue)}
              aria-label={`Rate ${upperHalfValue} out of 5 stars`}
              aria-pressed={clampedValue === upperHalfValue}
            />
          </span>
        );
      })}
    </div>
  );
}
