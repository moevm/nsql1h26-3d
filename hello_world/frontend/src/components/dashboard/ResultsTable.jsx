import React from "react";
import { ArrowUpDown } from "lucide-react";

const StatusBadge = ({ status }) => {
  const styles = {
    Completed: "bg-lime/10 text-lime border-lime/20",
    Processing: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20",
    Active: "bg-cyan/10 text-cyan border-cyan/20",
    Queued: "bg-muted text-muted-foreground border-border",
  };
  const dots = {
    Completed: "bg-lime",
    Processing: "bg-yellow-400 animate-pulse",
    Active: "bg-cyan animate-pulse",
    Queued: "bg-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${styles[status] || styles.Queued}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status] || dots.Queued}`} />
      {status}
    </span>
  );
};

const defaultResults = [
  { algo: "KD-Tree",  buildTime: "35.4 ms",  memory: "124 MB",  accuracy: "99.2%",  status: "Completed" },
  { algo: "Octree",   buildTime: "44.2 ms",  memory: "98 MB",   accuracy: "98.7%",  status: "Completed" },
  { algo: "BVH",      buildTime: "27.1 ms",  memory: "156 MB",  accuracy: "99.8%",  status: "Active" },
  { algo: "LSH",      buildTime: "19.6 ms",  memory: "78 MB",   accuracy: "95.1%",  status: "Processing" },
  { algo: "R-Tree",   buildTime: "—",        memory: "—",       accuracy: "—",      status: "Queued" },
];

export default function ResultsTable({ results }) {
  const rows = results || defaultResults;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Results</h3>
        <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowUpDown className="w-3 h-3" /> Sort
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {["Algorithm", "Build Time", "Memory Usage", "Accuracy", "Status"].map(col => (
                <th key={col} className="px-4 py-2.5 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{row.algo}</td>
                <td className="px-4 py-3 font-mono text-cyan">{row.buildTime}</td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{row.memory}</td>
                <td className="px-4 py-3 font-mono text-lime">{row.accuracy}</td>
                <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}