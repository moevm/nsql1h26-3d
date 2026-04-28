import React, { useState } from "react";
import { Play, ChevronDown, Loader2 } from "lucide-react";

const clouds = [
  { id: "sphere", label: "Sphere Cloud", pts: "50K pts" },
  { id: "bunny", label: "Torus Knot", pts: "50K pts" },
  { id: "random", label: "Random Scatter", pts: "50K pts" },
];

const algorithms = [
  { id: "kdtree", label: "KD-Tree" },
  { id: "octree", label: "Octree" },
  { id: "bvh", label: "BVH" },
  { id: "lsh", label: "LSH" },
];

export default function BenchmarkControls({ onCloudChange, onRun, isRunning, hideCloudSelect }) {
  const [selectedCloud, setSelectedCloud] = useState("sphere");
  const [selectedAlgo, setSelectedAlgo] = useState("kdtree");

  const handleRun = () => {
    onRun(selectedCloud, selectedAlgo);
  };

  const handleCloudChange = (val) => {
    setSelectedCloud(val);
    onCloudChange?.(val);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Step 2 · Run Benchmark</h3>
        <span className="text-[10px] font-mono text-cyan/60">CONFIG</span>
      </div>

      <div className={`grid gap-2 ${hideCloudSelect ? "grid-cols-1" : "grid-cols-2"}`}>
        {/* Select Cloud (optional) */}
        {!hideCloudSelect && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Point Cloud</label>
            <div className="relative">
              <select
                value={selectedCloud}
                onChange={(e) => handleCloudChange(e.target.value)}
                className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground cursor-pointer focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
              >
                {clouds.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        )}

        {/* Select Algorithm */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Algorithm</label>
          <div className="relative">
            <select
              value={selectedAlgo}
              onChange={(e) => setSelectedAlgo(e.target.value)}
              className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground cursor-pointer focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
            >
              {algorithms.map(a => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-3 h-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Run Button */}
      <button
        onClick={handleRun}
        disabled={isRunning}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all
          bg-cyan text-background hover:brightness-110 active:scale-[0.98]
          disabled:opacity-50 disabled:cursor-not-allowed
          glow-cyan"
      >
        {isRunning ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
        ) : (
          <><Play className="w-3.5 h-3.5" /> Run Benchmark</>
        )}
      </button>
    </div>
  );
}