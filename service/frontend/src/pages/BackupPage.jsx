import React, { useState } from "react";
import { Download, Upload, Shield, Loader2, Check, AlertTriangle } from "lucide-react";
import { pointCloud } from "@/api/pointCloudClient";

export default function BackupPage({ user }) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [exportedData, setExportedData] = useState(null);

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Admin access required</p>
        </div>
      </div>
    );
  }

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const backup = await pointCloud.backup.export();
      const datasets = backup.entities?.datasets ?? [];
      const benchmarks = backup.entities?.benchmarks ?? [];
      const users = backup.entities?.users ?? [];
      const statusEvents = backup.entities?.benchmark_status_events ?? [];

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pointcloud_backup_${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportedData({
        datasets: datasets.length,
        benchmarks: benchmarks.length,
        users: users.length,
        ...(statusEvents.length > 0 && { statusEvents: statusEvents.length }),
      });
    } catch (e) {
      setExportError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.entities) {
        setImportError("Invalid backup file format");
        return;
      }

      await pointCloud.backup.importReplace(backup);
      setImportDone(true);
      setTimeout(() => setImportDone(false), 3000);
    } catch (err) {
      setImportError(err.message || "Import failed");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Download className="w-4 h-4 text-cyan" /> Backup & Export
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Full system data import / export. Admin only.</p>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Export All Data</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Downloads a full JSON backup: all datasets, benchmark results, and users.</p>
        </div>

        {exportedData && (
          <div className="flex flex-wrap gap-4 py-2">
            {[
              { label: "Datasets", value: exportedData.datasets },
              { label: "Benchmarks", value: exportedData.benchmarks },
              { label: "Users", value: exportedData.users },
              ...(exportedData.statusEvents != null ? [{ label: "Status events", value: exportedData.statusEvents }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-lg font-bold text-cyan">{value}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        {exportError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {exportError}
          </p>
        )}

        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-cyan text-background text-xs font-semibold glow-cyan hover:brightness-110 disabled:opacity-50 transition-all"
        >
          {exporting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Exporting…</> : <><Download className="w-3.5 h-3.5" /> Download Backup (.json)</>}
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Import Data</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Restore from a previously exported backup file. Existing records are replaced by imported data.</p>
        </div>

        <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-400/5 border border-yellow-400/20">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
          <p className="text-[10px] text-yellow-400">Import replaces existing data in all collections.</p>
        </div>

        <label className={`flex items-center gap-2 px-5 py-2.5 rounded-md text-xs font-semibold cursor-pointer transition-all w-fit
          ${importing ? "bg-secondary text-muted-foreground" : "bg-secondary border border-border text-foreground hover:border-primary/40"}
          ${importDone ? "border-lime/30 text-lime" : ""}
        `}>
          {importing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</> : importDone ? <><Check className="w-3.5 h-3.5" /> Import Complete!</> : <><Upload className="w-3.5 h-3.5" /> Choose Backup File (.json)</>}
          <input type="file" accept=".json" className="hidden" onChange={handleImport} disabled={importing} />
        </label>

        {importError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {importError}
          </p>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">What Gets Exported</h3>
        <div className="space-y-2">
          {[
            { entity: "Datasets", desc: "All point cloud datasets (generated & uploaded)" },
            { entity: "Benchmark Results", desc: "All algorithm benchmark runs and metrics" },
            { entity: "Status history", desc: "Benchmark status change events (when available)" },
            { entity: "Users", desc: "User profiles and roles (passwords excluded)" },
          ].map(({ entity, desc }) => (
            <div key={entity} className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan mt-1.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">{entity}</p>
                <p className="text-[10px] text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
