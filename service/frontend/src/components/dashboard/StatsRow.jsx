import React from "react";
import { Activity, Database, Clock } from "lucide-react";

const stats = [
  { label: "Total Datasets", value: "14", unit: "", icon: Database, color: "text-cyan" },
  { label: "Algorithms Tested", value: "8", unit: "", icon: Activity, color: "text-lime" },
  { label: "Avg Build Time", value: "31.5", unit: "ms", icon: Clock, color: "text-purple-400" },
];

export default function StatsRow() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map(({ label, value, unit, icon: Icon, color }) => (
        <div key={label} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
          <div className={`p-2 rounded-md bg-secondary ${color}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
            <p className={`text-lg font-bold leading-tight ${color}`}>
              {value}<span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}