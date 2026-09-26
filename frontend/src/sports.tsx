import { Activity, Bike, Dumbbell, Footprints, Mountain, Waves, type LucideIcon } from "lucide-react";
import type { Family } from "./api";

/** Fixed order = chart stacking order = validated palette order. Never reorder by value. */
export const FAMILIES: Family[] = ["running", "cycling", "swimming", "walking", "fitness", "other"];

export const SPORTS: Record<Family, { label: string; icon: LucideIcon }> = {
  running: { label: "Running", icon: Footprints },
  cycling: { label: "Cycling", icon: Bike },
  swimming: { label: "Swimming", icon: Waves },
  walking: { label: "Walking & hiking", icon: Mountain },
  fitness: { label: "Strength & fitness", icon: Dumbbell },
  other: { label: "Other", icon: Activity },
};

/** CSS variable holding the family's color (defined per theme in styles.css). */
export function sportColor(family: Family): string {
  return `var(--sport-${family})`;
}

/** Colored badge with the sport icon: identity never relies on color alone. */
export function SportBadge({ family, size = 32 }: { family: Family; size?: number }) {
  const Icon = SPORTS[family].icon;
  return (
    <span
      className="sport-badge"
      style={{ width: size, height: size, ["--badge-color" as string]: sportColor(family) }}
      title={SPORTS[family].label}
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={2} aria-hidden />
    </span>
  );
}
