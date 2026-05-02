import React from "react";
import { Database, FlaskConical, BoxSelect, Settings, User, ChevronRight, Cpu, Shield, Download } from "lucide-react";

const userNavItems = [
  { icon: Database, label: "My Datasets", id: "datasets" },
  { icon: FlaskConical, label: "Benchmarks", id: "benchmarks" },
  { icon: BoxSelect, label: "Spatial Search", id: "spatial" },
  { icon: Settings, label: "Settings", id: "settings" },
  { icon: User, label: "Profile", id: "profile" },
];

const adminNavItems = [
  { icon: Database, label: "All Datasets", id: "datasets" },
  { icon: FlaskConical, label: "Benchmarks", id: "benchmarks" },
  { icon: BoxSelect, label: "Spatial Search", id: "spatial" },
  { icon: Shield, label: "Admin Panel", id: "admin" },
  { icon: Download, label: "Backup & Export", id: "backup" },
  { icon: Settings, label: "Settings", id: "settings" },
  { icon: User, label: "Profile", id: "profile" },
];

export default function Sidebar({ activePage, setActivePage, isAdmin }) {
  const navItems = isAdmin ? adminNavItems : userNavItems;

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col h-full border-r border-border bg-card">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center glow-cyan">
          <Cpu className="w-4 h-4 text-cyan" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground leading-tight">PointCloud</p>
          <p className="text-[10px] text-muted-foreground leading-tight">Benchmark Suite</p>
        </div>
      </div>

      {/* Role badge */}
      {isAdmin && (
        <div className="mx-3 mt-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-yellow-400/10 border border-yellow-400/20">
          <Shield className="w-3 h-3 text-yellow-400" />
          <span className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wider">Administrator</span>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {navItems.map(({ icon: Icon, label, id }) => {
          const active = activePage === id;
          return (
            <button
              key={id}
              onClick={() => setActivePage(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all group ${
                active
                  ? "bg-primary/10 text-cyan border border-primary/20 glow-cyan"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${active ? "text-cyan" : "group-hover:text-foreground"}`} />
              <span className="font-medium">{label}</span>
              {active && <ChevronRight className="w-3 h-3 ml-auto text-cyan/60" />}
            </button>
          );
        })}
      </nav>

      {/* Footer status */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-lime animate-pulse" />
          <span className="text-[10px] text-muted-foreground font-mono">SYS ONLINE · v2.4.1</span>
        </div>
      </div>
    </aside>
  );
}