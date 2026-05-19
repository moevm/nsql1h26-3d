import React, { useState, useEffect, useCallback } from "react";
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

export default function DatasetsPage({ user, onNavigateToBenchmark, onNavigateToVisualize: _v, onNavigateToDataset: _d }) {
  const [datasets, setDatasets] = useState([]);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [lastBenchmarkByDataset, setLastBenchmarkByDataset] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [nameQuery, setNameQuery] = useState("");
  const [descriptionQuery, setDescriptionQuery] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [sortBy, setSortBy] = useState("-created_date");
  const [page, setPage] = useState(1);
  const [crossMinRuns, setCrossMinRuns] = useState("");
  const [crossMaxRuns, setCrossMaxRuns] = useState("");
  const [crossStatus, setCrossStatus] = useState("");
  const [listView, setListView] = useState("cards");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pointMin, setPointMin] = useState("");
  const [pointMax, setPointMax] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const baseFilter = {};
    if (nameQuery.trim()) baseFilter.name_contains = nameQuery.trim();
    if (descriptionQuery.trim()) baseFilter.description_contains = descriptionQuery.trim();
    if (filterSource) baseFilter.source = filterSource;
    if (dateFrom) baseFilter.created_date_from = new Date(`${dateFrom}T00:00:00.000Z`).toISOString();
    if (dateTo) baseFilter.created_date_to = new Date(`${dateTo}T23:59:59.999Z`).toISOString();
    if (pointMin !== "" && !Number.isNaN(Number(pointMin))) baseFilter.point_count_min = Number(pointMin);
    if (pointMax !== "" && !Number.isNaN(Number(pointMax))) baseFilter.point_count_max = Number(pointMax);

    const runCountMin = crossMinRuns === "" ? null : parseInt(crossMinRuns, 10);
    const runCountMax = crossMaxRuns === "" ? null : parseInt(crossMaxRuns, 10);
    const runBucket = crossStatus || "all";

    try {
      const res = await pointCloud.datasets.query({
        filter: baseFilter,
        order_by: sortBy,
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        run_status_bucket: runBucket,
        run_count_min: runCountMin != null && !Number.isNaN(runCountMin) ? runCountMin : null,
        run_count_max: runCountMax != null && !Number.isNaN(runCountMax) ? runCountMax : null,
      });
      setDatasets(res.items ?? []);
      setTotalFiltered(res.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [
    user,
    nameQuery,
    descriptionQuery,
    filterSource,
    sortBy,
    page,
    dateFrom,
    dateTo,
    pointMin,
    pointMax,
    crossMinRuns,
    crossMaxRuns,
    crossStatus,
  ]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (!user || datasets.length === 0) {
      setLastBenchmarkByDataset({});
      return;
    }
    const idSet = new Set(datasets.map((d) => d.id));
    const filter = user?.role === "admin" ? {} : { created_by: user?.email };
    pointCloud.entities.BenchmarkResult.filter(filter, "-created_date", 1000).then((results) => {
      const byDs = {};
      results.forEach((r) => {
        if (!r.dataset_id || !idSet.has(r.dataset_id)) return;
        if (!byDs[r.dataset_id] || (r.created_date && r.created_date > byDs[r.dataset_id]))
          byDs[r.dataset_id] = r.created_date;
      });
      setLastBenchmarkByDataset(byDs);
    });
  }, [user, datasets]);

  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  const handleDelete = async (id) => {
    await pointCloud.entities.Dataset.delete(id);
    await load();
  };

  const showFilters = !loading || totalFiltered > 0 || nameQuery || descriptionQuery || filterSource;

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

      {showFilters && (
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
          <div className="flex items-center gap-1 border-l border-border pl-2">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Added from</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="bg-secondary border border-border rounded-md px-2 py-1.5 text-xs text-foreground max-w-[140px]"
            />
            <span className="text-[10px] text-muted-foreground">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="bg-secondary border border-border rounded-md px-2 py-1.5 text-xs text-foreground max-w-[140px]"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Points</span>
            <input
              type="number"
              min={0}
              value={pointMin}
              onChange={e => { setPointMin(e.target.value); setPage(1); }}
              placeholder="min"
              className="w-20 bg-secondary border border-border rounded-md px-2 py-1.5 text-xs"
            />
            <span className="text-[10px] text-muted-foreground">–</span>
            <input
              type="number"
              min={0}
              value={pointMax}
              onChange={e => { setPointMax(e.target.value); setPage(1); }}
              placeholder="max"
              className="w-20 bg-secondary border border-border rounded-md px-2 py-1.5 text-xs"
            />
          </div>
          <select
            value={sortBy}
            onChange={e => { setSortBy(e.target.value); setPage(1); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div
            className="flex flex-wrap items-center gap-1.5 border-l border-border pl-2 max-w-xl"
            title="Фильтр по числу записей BenchmarkResult для датасета. Выберите, какие статусы учитывать (или все), затем диапазон количества таких запусков."
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Benchmark runs (по статусу ниже): от
            </span>
            <input
              type="number"
              min={0}
              value={crossMinRuns}
              onChange={e => { const v = e.target.value; setCrossMinRuns(v); setPage(1); }}
              className="w-14 bg-secondary border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
              placeholder="0"
            />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">до</span>
            <input
              type="number"
              min={0}
              value={crossMaxRuns}
              onChange={e => { const v = e.target.value; setCrossMaxRuns(v); setPage(1); }}
              className="w-14 bg-secondary border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
              placeholder="∞"
            />
            <select
              value={crossStatus}
              onChange={e => { setCrossStatus(e.target.value); setPage(1); }}
              className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50 min-w-[140px]"
            >
              <option value="">Все статусы</option>
              <option value="unfinished">Любые не completed</option>
              <option value="processing">processing</option>
              <option value="failed">failed</option>
              <option value="queued">queued</option>
              <option value="completed">completed</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-lg bg-card border border-border animate-pulse" />)}
        </div>
      ) : totalFiltered === 0 ? (
        <div className="text-center py-16 space-y-3">
          <span className="text-4xl">📂</span>
          <p className="text-sm text-muted-foreground">
            {datasets.length === 0 && !nameQuery && !descriptionQuery && !filterSource ? "No datasets yet. Create one above." : "No datasets match current filters."}
          </p>
        </div>
      ) : listView === "table" ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {(user?.role === "admin"
                    ? ["Name", "Source", "Points", "Added by", "Created", "Last run", ""]
                    : ["Name", "Source", "Points", "Created", "Last run", ""]
                  ).map(col => (
                    <th key={col} className="px-4 py-2.5 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datasets.map(ds => (
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
                    {user?.role === "admin" && (
                      <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground max-w-[140px] truncate" title={ds.created_by}>
                        {ds.created_by || "—"}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-muted-foreground">{ds.created_date ? new Date(ds.created_date).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {lastBenchmarkByDataset[ds.id] ? new Date(lastBenchmarkByDataset[ds.id]).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onNavigateToBenchmark?.(ds)}
                          className="flex items-center gap-1 py-1 px-2 rounded text-[10px] font-medium bg-primary/10 text-cyan border border-primary/20 hover:bg-primary/20"
                        >
                          <FlaskConical className="w-3 h-3" /> Benchmark
                        </button>
                        {(user?.role === "admin" || ds.created_by === user?.email) && (
                          <button
                            type="button"
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
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Previous</button>
              <span className="text-xs text-muted-foreground font-mono">{page} / {totalPages}</span>
              <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Next</button>
            </div>
          )}
        </div>
      ) : (
        <>
        <div className="grid grid-cols-3 gap-3">
          {datasets.map(ds => (
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
                {user?.role === "admin" && ds.created_by && (
                  <p className="text-[10px] font-mono text-muted-foreground mt-1 truncate" title={ds.created_by}>by {ds.created_by}</p>
                )}
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
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onNavigateToBenchmark?.(ds); }}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-cyan border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  <FlaskConical className="w-3 h-3" /> Benchmark
                </button>
                {(user?.role === "admin" || ds.created_by === user?.email) && (
                  <button
                    type="button"
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
              type="button"
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
              type="button"
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
