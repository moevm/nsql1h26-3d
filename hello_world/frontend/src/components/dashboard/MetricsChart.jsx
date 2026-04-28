import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const defaultData = [
  { pts: "1K",   kdtree: 2.1,  octree: 2.8,  bvh: 1.9,  lsh: 3.2 },
  { pts: "5K",   kdtree: 4.3,  octree: 5.1,  bvh: 3.7,  lsh: 4.9 },
  { pts: "10K",  kdtree: 8.2,  octree: 9.4,  bvh: 6.8,  lsh: 7.5 },
  { pts: "25K",  kdtree: 18.5, octree: 22.1, bvh: 14.2, lsh: 12.8 },
  { pts: "50K",  kdtree: 35.4, octree: 44.2, bvh: 27.1, lsh: 19.6 },
  { pts: "100K", kdtree: 68.7, octree: 89.3, bvh: 51.4, lsh: 31.2 },
  { pts: "250K", kdtree: 158,  octree: 201,  bvh: 118,  lsh: 58.4 },
  { pts: "500K", kdtree: 312,  octree: 398,  bvh: 229,  lsh: 97.6 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs space-y-1.5">
      <p className="font-mono text-muted-foreground uppercase tracking-wider mb-2">{label} pts</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground font-medium capitalize">{p.name}</span>
          <span className="ml-auto font-mono text-muted-foreground">{p.value} ms</span>
        </div>
      ))}
    </div>
  );
};

export default function MetricsChart({ liveData }) {
  const data = liveData || defaultData;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Real-time Metrics</h3>
        <span className="text-[10px] font-mono text-cyan/60">Build Time (ms) vs Point Count</span>
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 15% 18%)" />
            <XAxis dataKey="pts" tick={{ fill: "hsl(215 20% 55%)", fontSize: 10, fontFamily: "Inter" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "hsl(215 20% 55%)", fontSize: 10, fontFamily: "Inter" }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: "10px", fontFamily: "Inter", paddingTop: "8px" }}
              iconType="circle"
              iconSize={7}
            />
            <Line type="monotone" dataKey="kdtree" stroke="hsl(185 100% 50%)" strokeWidth={2} dot={false} name="KD-Tree" />
            <Line type="monotone" dataKey="octree" stroke="hsl(150 80% 45%)" strokeWidth={2} dot={false} name="Octree" />
            <Line type="monotone" dataKey="bvh" stroke="hsl(280 70% 65%)" strokeWidth={2} dot={false} name="BVH" />
            <Line type="monotone" dataKey="lsh" stroke="hsl(45 100% 55%)" strokeWidth={2} dot={false} name="LSH" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}