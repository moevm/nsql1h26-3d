import React from "react";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/SettingsContext";

function SettingRow({ checked, onCheckedChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setSetting } = useSettings();
  const set = (key) => (val) => setSetting(key, val);

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Configure viewer and application behaviour</p>
      </div>

      {[
        {
          title: "3D Viewport",
          items: [
            { key: "autoRotate", label: "Auto Rotate", description: "Slowly spin the point cloud when idle" },
            { key: "showGrid", label: "Show Grid", description: "Display floor grid in 3D viewport" },
            { key: "showAxes", label: "Show Axes", description: "Display XYZ axes helper" },
            { key: "highDensity", label: "High Density Mode", description: "Render more points (may impact performance)" },
          ]
        },
        {
          title: "Application",
          items: [
            { key: "liveMetrics", label: "Live Metrics", description: "Stream benchmark metrics in real-time" },
            { key: "autoSave", label: "Auto Save Datasets", description: "Automatically save generated datasets" },
            { key: "notifications", label: "Benchmark Notifications", description: "Notify when benchmark completes" },
          ]
        }
      ].map(section => (
        <div key={section.title} className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{section.title}</h3>
          {section.items.map(({ key, label, description }) => (
            <SettingRow key={key} checked={!!settings[key]} onCheckedChange={set(key)} label={label} description={description} />
          ))}
        </div>
      ))}

    </div>
  );
}