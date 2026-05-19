import React from "react";

const SOURCE_ICON = {
  uploaded: "📁",
  generated_sphere: "⚪",
  generated_torus: "🔁",
  generated_plane: "🏔",
  generated_random: "✦",
};

export default function DatasetPicker({ datasets = [], selectedId, onSelect, placeholder = "No datasets", className = "" }) {
  if (datasets.length === 0) {
    return (
      <p className={`text-xs text-muted-foreground py-4 ${className}`}>
        {placeholder}
      </p>
    );
  }

  return (
    <div className={`space-y-1.5 max-h-64 overflow-y-auto ${className}`}>
      {datasets.map(ds => (
        <button
          key={ds.id}
          type="button"
          onClick={() => onSelect?.(ds)}
          className={`w-full flex items-center gap-3 p-2.5 rounded-md border text-left transition-all ${
            selectedId === ds.id
              ? "border-primary/40 bg-primary/10 border-cyan/30"
              : "bg-secondary/50 border-border hover:border-primary/30 hover:bg-primary/5"
          }`}
        >
          <span className="text-base flex-shrink-0">
            {SOURCE_ICON[ds.source] || "✦"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{ds.name}</p>
            <p className="text-[10px] text-muted-foreground">{ds.point_count?.toLocaleString()} pts</p>
          </div>
        </button>
      ))}
    </div>
  );
}
