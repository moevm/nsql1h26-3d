import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { pointCloud } from "@/api/pointCloudClient";
import { Plus, Trash2, RefreshCw, FlaskConical, Search, LayoutGrid, List } from "lucide-react";
import DatasetCreateMenu from "../components/datasets/DatasetCreateMenu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SOURCE_LABEL = {
  generated_sphere: "Sphere",
  generated_torus: "Torus Knot",
  generated_random: "Random",
  generated_plane: "Terrain",
  uploaded: "Uploaded",
};

const SORT_OPTIONS = [
  { value: "-created_date", label: "Newest first" },
  { value: "created_date", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
  { value: "-name", label: "Name Z–A" },
];

const PAGE_SIZE = 20;

export default function DatasetsPage({ user, onNavigateToBenchmark, onNavigateToVisualize, onNavigateToDataset }) {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [lastBenchmarkByDataset, setLastBenchmarkByDataset] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [nameQuery, setNameQuery] = useState("");
  const [descriptionQuery, setDescriptionQuery] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [sortBy, setSortBy] = useState("-created_date");
  const [page, setPage] = useState(1);
  const [benchmarkResultsForCross, setBenchmarkResultsForCross] = useState([]);
  const [crossMinRuns, setCrossMinRuns] = useState("");
  const [crossMaxRuns, setCrossMaxRuns] = useState("");
  const [crossStatus, setCrossStatus] = useState("");
  const [listView, setListView] = useState("cards"); // "cards" | "table"

  const load = async () => {
    setLoading(true);
    const filter = user?.role === "admin" ? {} : { created_by: user?.email };
    const data = await pointCloud.entities.Dataset.filter(filter, "-created_date", 500);
    setDatasets(data);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if (!user) return;
    const filter = user?.role === "admin" ? {} : { created_by: user?.email };
    pointCloud.entities.BenchmarkResult.filter(filter, "-created_date", 500).then(results => {
      const byDs = {};
      results.forEach(r => {
        if (r.dataset_id && (!byDs[r.dataset_id] || (r.created_date && r.created_date > byDs[r.dataset_id])))
          byDs[r.dataset_id] = r.created_date;
      });
      setLastBenchmarkByDataset(byDs);
      setBenchmarkResultsForCross(results);
    });
  }, [user]);

  const datasetRunCounts = useMemo(() => {
    const counts = {};
    benchmarkResultsForCross.forEach(r => {
      if (!r.dataset_id) return;
      if (!counts[r.dataset_id]) counts[r.dataset_id] = { processing: 0, failed: 0, queued: 0, completed: 0 };
      const s = (r.status || "").toLowerCase();
      if (s in counts[r.dataset_id]) counts[r.dataset_id][s]++;
    });
    return counts;
  }, [benchmarkResultsForCross]);

  const filteredAndSorted = useMemo(() => {
    let list = [...datasets];
    const nameQ = nameQuery.trim().toLowerCase();
    const descQ = descriptionQuery.trim().toLowerCase();
    if (nameQ) {
      list = list.filter(d => (d.name || "").toLowerCase().includes(nameQ));
    }
    if (descQ) {
      list = list.filter(d => (d.description || "").toLowerCase().includes(descQ));
    }
    if (filterSource) list = list.filter(d => (d.source || "") === filterSource);
    const minR = crossMinRuns === "" ? null : parseInt(crossMinRuns, 10);
    const maxR = crossMaxRuns === "" ? null : parseInt(crossMaxRuns, 10);
    if ((minR != null && !isNaN(minR)) || (maxR != null && !isNaN(maxR))) {
      const minVal = minR != null && !isNaN(minR) ? minR : 0;
      const maxVal = maxR != null && !isNaN(maxR) ? maxR : Infinity;
      if (crossStatus) {
        list = list.filter(d => {
          const c = datasetRunCounts[d.id];
          if (!c) return false;
          const n = crossStatus === "unfinished"
            ? (c.processing || 0) + (c.failed || 0) + (c.queued || 0)
            : (c[crossStatus] || 0);
          return n >= minVal && n <= maxVal;
        });
      }
    }
    const desc = sortBy.startsWith("-");
    const key = desc ? sortBy.slice(1) : sortBy;
    list.sort((a, b) => {
      const va = a[key] ?? "";
      const vb = b[key] ?? "";
      if (typeof va === "string" && typeof vb === "string") return desc ? vb.localeCompare(va) : va.localeCompare(vb);
      return desc ? (vb > va ? 1 : vb < va ? -1 : 0) : (va > vb ? 1 : va < vb ? -1 : 0);
    });
    return list;
  }, [datasets, nameQuery, descriptionQuery, filterSource, sortBy, crossMinRuns, crossMaxRuns, crossStatus, datasetRunCounts]);

  const totalFiltered = filteredAndSorted.length;
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredAndSorted.slice(start, start + PAGE_SIZE);
  }, [filteredAndSorted, page]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  const handleDelete = async (id) => {
    await pointCloud.entities.Dataset.delete(id);
    setDatasets(prev => prev.filter(d => d.id !== id));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {user?.role === "admin" ? "All Datasets" : "My Datasets"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{totalFiltered} dataset{totalFiltered !== 1 ? "s" : ""} found</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setListView("cards")}
              className={`p-2 ${listView === "cards" ? "bg-primary/10 text-cyan border-primary/20" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              title="Cards"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setListView("table")}
              className={`p-2 ${listView === "table" ? "bg-primary/10 text-cyan border-primary/20" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              title="Table"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={load} className="w-8 h-8 rounded-md bg-secondary border border-border flex items-center justify-center hover:border-primary/40 transition-colors">
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <Popover open={showPicker} onOpenChange={setShowPicker}>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-cyan text-background text-xs font-semibold glow-cyan hover:brightness-110 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> New Dataset
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-[420px] p-0 border-border bg-card">
              <DatasetCreateMenu
                onSelect={() => { setShowPicker(false); load(); }}
                onCreated={() => { setShowPicker(false); load(); }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {!loading && datasets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={nameQuery}
              onChange={e => { setNameQuery(e.target.value); setPage(1); }}
              placeholder="Name contains…"
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="relative min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={descriptionQuery}
              onChange={e => { setDescriptionQuery(e.target.value); setPage(1); }}
              placeholder="Description contains…"
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <select
            value={filterSource}
            onChange={e => { setFilterSource(e.target.value); setPage(1); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABEL).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={e => { setSortBy(e.target.value); setPage(1); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 border-l border-border pl-2">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Runs from</span>
            <input
              type="number"
              min={0}
              value={crossMinRuns}
              onChange={e => { const v = e.target.value; setCrossMinRuns(v); setPage(1); }}
              className="w-14 bg-secondary border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
              placeholder="0"
            />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">to</span>
            <input
              type="number"
              min={0}
              value={crossMaxRuns}
              onChange={e => { setCrossMaxRuns(e.target.value); setPage(1); }}
              className="w-14 bg-secondary border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
              placeholder="—"
            />
            <select
              value={crossStatus}
              onChange={e => { setCrossStatus(e.target.value); setPage(1); }}
              className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="">—</option>
              <option value="unfinished">Any non-completed</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
              <option value="queued">Queued</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-lg bg-card border border-border animate-pulse" />)}
        </div>
      ) : datasets.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <span className="text-4xl">📂</span>
          <p className="text-sm text-muted-foreground">No datasets yet. Create one above.</p>
        </div>
      ) : totalFiltered === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-sm text-muted-foreground">No datasets match current filters.</p>
        </div>
      ) : listView === "table" ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["Name", "Source", "Points", "Created", "Last run", ""].map(col => (
                    <th key={col} className="px-4 py-2.5 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map(ds => (
                  <tr key={ds.id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        to={`/dataset/${ds.id}`}
                        className="font-medium text-foreground hover:text-cyan truncate block max-w-[200px]"
                        title={ds.name}
                      >
                        {ds.name || "—"}
                      </Link>
                      {ds.description && <p className="text-[10px] text-muted-foreground truncate max-w-[200px] mt-0.5">{ds.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-mono bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
                        {SOURCE_LABEL[ds.source] || ds.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{ds.point_count != null ? ds.point_count.toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{ds.created_date ? new Date(ds.created_date).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {lastBenchmarkByDataset[ds.id] ? new Date(lastBenchmarkByDataset[ds.id]).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onNavigateToBenchmark?.(ds)}
                          className="flex items-center gap-1 py-1 px-2 rounded text-[10px] font-medium bg-primary/10 text-cyan border border-primary/20 hover:bg-primary/20"
                        >
                          <FlaskConical className="w-3 h-3" /> Benchmark
                        </button>
                        {(user?.role === "admin" || ds.created_by === user?.email) && (
                          <button
                            onClick={() => setDeleteTarget(ds)}
                            className="p-1 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 py-2 border-t border-border">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Previous</button>
              <span className="text-xs text-muted-foreground font-mono">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Next</button>
            </div>
          )}
        </div>
      ) : (
        <>
        <div className="grid grid-cols-3 gap-3">
          {paginated.map(ds => (
            <div key={ds.id} className="bg-card border border-border rounded-lg p-4 space-y-3 hover:border-primary/30 transition-colors">
              <Link
                to={`/dataset/${ds.id}`}
                className="block w-full text-left focus:outline-none focus:ring-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate hover:text-cyan">{ds.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-mono bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
                        {SOURCE_LABEL[ds.source] || ds.source}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{ds.point_count?.toLocaleString()} pts</span>
                    </div>
                  </div>
                </div>
                {ds.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ds.description}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[10px] font-mono text-muted-foreground">
                  <span>Created: {ds.created_date ? new Date(ds.created_date).toLocaleString() : "—"}</span>
                  {lastBenchmarkByDataset[ds.id] && (
                    <span>Last run: {new Date(lastBenchmarkByDataset[ds.id]).toLocaleString()}</span>
                  )}
                </div>
              </Link>
              <div className="flex gap-2 pt-1 border-t border-border/50">
                <button
                  onClick={(e) => { e.stopPropagation(); onNavigateToBenchmark?.(ds); }}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-cyan border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  <FlaskConical className="w-3 h-3" /> Benchmark
                </button>
                {(user?.role === "admin" || ds.created_by === user?.email) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(ds); }}
                    className="flex items-center justify-center gap-1 py-1.5 px-3 rounded-md text-xs font-medium bg-destructive text-destructive-foreground border border-destructive hover:bg-destructive/90 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground font-mono">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none"
            >
              Next
            </button>
          </div>
        )}
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dataset</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id).then(() => setDeleteTarget(null))}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}