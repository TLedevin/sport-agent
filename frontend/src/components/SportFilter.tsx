import { LayoutGrid } from "lucide-react";
import type { Family } from "../api";
import { SPORTS, sportColor } from "../sports";

type Props = { families: Family[]; selected: Family | null; onSelect: (family: Family | null) => void };

/** Sport icons in a row; clicking one filters the period tiles. null means all sports. */
export default function SportFilter({ families, selected, onSelect }: Props) {
  const options: { key: Family | null; label: string }[] = [
    { key: null, label: "All sports" },
    ...families.map((f) => ({ key: f, label: SPORTS[f].label })),
  ];

  return (
    <div className="sport-filter" role="group" aria-label="Filter by sport">
      {options.map(({ key, label }) => {
        const Icon = key ? SPORTS[key].icon : LayoutGrid;
        const active = key === selected;
        return (
          <button
            key={key ?? "all"}
            type="button"
            className={`sport-filter-option ${active ? "active" : ""}`}
            style={{ ["--badge-color" as string]: key ? sportColor(key) : "var(--text-primary)" }}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onSelect(key)}
          >
            <Icon size={18} strokeWidth={2} aria-hidden />
          </button>
        );
      })}
      <span className="sport-filter-label" aria-hidden>
        {options.find((o) => o.key === selected)?.label}
      </span>
    </div>
  );
}
