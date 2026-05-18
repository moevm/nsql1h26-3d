import React, { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { pointCloud } from "@/api/pointCloudClient";
import Sidebar from "../components/dashboard/Sidebar";
import TopBar from "../components/dashboard/TopBar";
import PointCloudViewer from "../components/dashboard/PointCloudViewer";
import DatasetPicker from "../components/datasets/DatasetPicker";
import DatasetsPage from "./DatasetsPage";
import BenchmarksPage from "./BenchmarksPage";
import ProfilePage from "./ProfilePage";
import SettingsPage from "./SettingsPage";
import AdminPage from "./AdminPage";
import BackupPage from "./BackupPage";
import { useSettings } from "@/lib/SettingsContext";
import { toast } from "@/components/ui/use-toast";
import { Loader2, Play } from "lucide-react";

const PAGE_TITLES = {
  datasets: "Datasets",
  benchmarks: "Benchmarks",
  spatial: "Search",
  settings: "Settings",
  profile: "User Profile",
  admin: "Users",
  backup: "Backup & Export",
};

const SOURCE_TO_CLOUD = {
  generated_sphere: "sphere",
  generated_torus: "bunny",
  generated_random: "random",
  generated_plane: "random",
  uploaded: "random",
};

const ALGORITHMS = [
  { id: "kdtree", label: "KD-Tree" },
  { id: "octree", label: "Octree" },
  { id: "balltree", label: "Ball Tree" },
  { id: "rtree", label: "R-Tree" },
  { id: "svo", label: "Sparse Voxel Octree" },
  { id: "phtree", label: "PH-Tree" },
  { id: "morton", label: "Morton Code" },
  { id: "hilbert", label: "Hilbert Curve" },
];

const RANGE_BOUND_KEYS = ["xMin", "xMax", "yMin", "yMax", "zMin", "zMax"];

function formatMs(value) {
  if (value == null) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function getApiErrorMessage(error) {
  const fallback = String(error?.message || error || "Range query failed");
  try {
    const parsed = JSON.parse(fallback);
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      return parsed.detail.map(item => item.msg || item.message || JSON.stringify(item)).join("; ");
    }
  } catch {
  }
  return fallback;
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);

  // Dataset state
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [savedDatasets, setSavedDatasets] = useState([]);
  const [cloudType, setCloudType] = useState("sphere");

  const [benchmarkResults, setBenchmarkResults] = useState([]);
  const [datasetBenchmarkResults, setDatasetBenchmarkResults] = useState([]);
  const [runningAlgos, setRunningAlgos] = useState(new Set());
  const [editingName, setEditingName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingComment, setEditingComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  // Spatial range query state
  const [rangeBounds, setRangeBounds] = useState({ xMin: -0.5, xMax: 0.5, yMin: -0.5, yMax: 0.5, zMin: -0.5, zMax: 0.5 });
  const [rangeQueryRunning, setRangeQueryRunning] = useState(false);
  const [rangeQueryResult, setRangeQueryResult] = useState(null);
  const [rangeQueryError, setRangeQueryError] = useState("");
  const [spatialIndexes, setSpatialIndexes] = useState([]);
  const [selectedIndexAlgo, setSelectedIndexAlgo] = useState("");
  const [spatialIndexesLoading, setSpatialIndexesLoading] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const selectedDatasetIdRef = useRef(null);
  const { settings } = useSettings();
  const { datasetId, benchmarkId, userId } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const segment = pathname.slice(1).split("/")[0];
  const VALID_SECTIONS = ["datasets", "benchmarks", "spatial", "settings", "profile", "admin", "backup"];
  const activePage = datasetId
    ? "dataset"
    : benchmarkId
      ? "benchmarks"
      : userId
        ? "admin"
        : (VALID_SECTIONS.includes(segment) ? segment : "datasets");

  useEffect(() => {
    if (!datasetId) {
      setSelectedDataset(null);
      return;
    }
    pointCloud.entities.Dataset.get(datasetId).then((ds) => {
      if (ds) {
        setSelectedDataset(ds);
        setCloudType(SOURCE_TO_CLOUD[ds.source] || "random");
      } else {
        navigate("/datasets");
      }
    }).catch(() => navigate("/datasets"));
  }, [datasetId, navigate]);

  useEffect(() => {
    if (!datasetId) setSelectedDataset(null);
  }, [datasetId]);

  useEffect(() => {
    pointCloud.auth.me().then(u => {
      setUser(u);
      setUserLoading(false);
    }).catch(() => {
      pointCloud.auth.redirectToLogin(window.location.href);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const filter = user.role === "admin" ? {} : { created_by: user.email };
    pointCloud.entities.Dataset.filter(filter, "-created_date", 50).then(setSavedDatasets);
  }, [user]);

  useEffect(() => {
    if (activePage !== "spatial" || !user) return;
    const filter = user.role === "admin" ? {} : { created_by: user.email };
    pointCloud.entities.Dataset.filter(filter, "-created_date", 50).then(setSavedDatasets);
  }, [activePage, user]);

  useEffect(() => {
    selectedDatasetIdRef.current = selectedDataset?.id ?? null;
    if (!selectedDataset) {
      setSpatialIndexes([]);
      setSelectedIndexAlgo("");
      setDatasetBenchmarkResults([]);
      setEditingName("");
      setEditingComment("");
      setRangeQueryResult(null);
      setRangeQueryError("");
      return;
    }
    const dsId = selectedDataset.id;
    setEditingName(selectedDataset.name || "");
    setEditingComment(selectedDataset.comment ?? "");
    setSpatialIndexesLoading(true);
    pointCloud.entities.BenchmarkResult.filter({ dataset_id: dsId }, "-created_date", 100)
      .then(results => {
        if (selectedDatasetIdRef.current !== dsId) return;
        setDatasetBenchmarkResults(results);
        const completed = results.filter(r => (r.status || "").toLowerCase() === "completed");
        const unique = Array.from(new Set(completed.map(r => r.algorithm))).filter(Boolean);
        setSpatialIndexes(unique);
        setSelectedIndexAlgo(prev =>
          prev && unique.includes(prev) ? prev : (unique[0] || "")
        );
      })
      .finally(() => {
        if (selectedDatasetIdRef.current === dsId) setSpatialIndexesLoading(false);
      });
  }, [selectedDataset]);

  const loadDatasetBenchmarks = useCallback(() => {
    if (!selectedDataset) return;
    pointCloud.entities.BenchmarkResult.filter({ dataset_id: selectedDataset.id }, "-created_date", 100)
      .then(setDatasetBenchmarkResults);
  }, [selectedDataset]);

  const handleSelectDataset = (ds) => {
    setSelectedDataset(ds);
    setCloudType(SOURCE_TO_CLOUD[ds.source] || "random");
    setBenchmarkResults([]);
    setRangeQueryResult(null);
    setRangeQueryError("");
    setRunningAlgos(new Set());
  };

  const handleSaveDatasetName = useCallback(async () => {
    if (!selectedDataset || editingName.trim() === (selectedDataset.name || "").trim()) return;
    setSavingName(true);
    const updated = await pointCloud.entities.Dataset.update(selectedDataset.id, { name: editingName.trim() });
    setSelectedDataset(prev => prev && prev.id === updated.id ? { ...prev, ...updated } : prev);
    setSavingName(false);
  }, [selectedDataset, editingName]);

  const handleSaveDatasetComment = useCallback(async () => {
    if (!selectedDataset || editingComment === (selectedDataset.comment ?? "")) return;
    setSavingComment(true);
    const updated = await pointCloud.entities.Dataset.update(selectedDataset.id, { comment: editingComment });
    setSelectedDataset(prev => prev && prev.id === updated.id ? { ...prev, ...updated } : prev);
    setSavingComment(false);
  }, [selectedDataset, editingComment]);

  const getRowForAlgo = useCallback((algoId) => {
    const activeDatasetId = selectedDataset?.id;
    const fromSession = benchmarkResults
      .filter(
        (r) =>
          r.algo?.toLowerCase() === algoId.toLowerCase() &&
          (!activeDatasetId || r.datasetId === activeDatasetId)
      )
      .sort((a, b) => (b.id || "").localeCompare(a.id || ""))[0];
    if (fromSession) {
      const processing = fromSession.status === "Processing";
      const buildTime = processing && settings.liveMetrics && fromSession.startedAt
        ? `${Math.round((Date.now() - fromSession.startedAt) / 100) / 10}s`
        : (fromSession.buildTime ?? "—");
      return {
        algo: fromSession.algo || algoId.toUpperCase(),
        buildTime,
        memory: fromSession.memory ?? "—",
        accuracy: fromSession.accuracy ?? "—",
        status: fromSession.status || "Processing",
      };
    }
    const fromApi = datasetBenchmarkResults.filter(r => (r.algorithm || "").toLowerCase() === algoId.toLowerCase()).sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""))[0];
    if (fromApi) {
      const status = (fromApi.status || "completed").charAt(0).toUpperCase() + (fromApi.status || "").slice(1);
      return {
        algo: (fromApi.algorithm || algoId).toUpperCase(),
        buildTime: fromApi.build_time_ms != null ? `${fromApi.build_time_ms} ms` : "—",
        memory: fromApi.memory_mb != null ? `${fromApi.memory_mb} MB` : "—",
        accuracy: fromApi.accuracy_pct != null ? `${fromApi.accuracy_pct}%` : "—",
        status,
      };
    }
    return { algo: algoId.toUpperCase(), buildTime: "—", memory: "—", accuracy: "—", status: "—" };
  }, [benchmarkResults, datasetBenchmarkResults, settings.liveMetrics, liveTick, selectedDataset?.id]);

  const handleRunRangeQuery = useCallback(async () => {
    if (!selectedDataset || !selectedIndexAlgo) return;
    const bounds = {};
    for (const key of RANGE_BOUND_KEYS) {
      const value = Number(rangeBounds[key]);
      if (!Number.isFinite(value)) {
        const message = "Enter numeric values for all range bounds.";
        setRangeQueryError(message);
        setRangeQueryResult(null);
        return;
      }
      bounds[key] = value;
    }

    setRangeQueryRunning(true);
    setRangeQueryResult(null);
    setRangeQueryError("");
    try {
      const result = await pointCloud.spatial.rangeQuery({
        dataset_id: selectedDataset.id,
        algorithm: selectedIndexAlgo,
        bounds,
      });
      setRangeQueryResult({
        algorithm: result.algorithm || selectedIndexAlgo,
        count: Number(result.count ?? 0),
        indexedCount: Number(result.indexed_count ?? result.count ?? 0),
        bruteCount: Number(result.brute_count ?? result.count ?? 0),
        pointCount: Number(result.point_count ?? selectedDataset.point_count ?? 0),
        indexTimeMs: result.index_time_ms ?? result.indexed_time_ms,
        bruteTimeMs: result.brute_time_ms,
        indexBuildTimeMs: result.index_build_time_ms,
        candidateCount: result.candidate_count,
        bucketCount: result.bucket_count,
        visitedBucketCount: result.visited_bucket_count,
        indexKind: result.index_kind,
        emptyResult: Boolean(result.empty_result),
      });
    } catch (error) {
      const message = getApiErrorMessage(error);
      setRangeQueryError(message);
      toast({ title: "Range query failed", description: message, variant: "destructive" });
    } finally {
      setRangeQueryRunning(false);
    }
  }, [selectedDataset, selectedIndexAlgo, rangeBounds]);

  useEffect(() => {
    if (runningAlgos.size === 0 || !settings.liveMetrics) return;
    const id = setInterval(() => setLiveTick(t => t + 1), 300);
    return () => clearInterval(id);
  }, [runningAlgos.size, settings.liveMetrics]);

  const handleRun = useCallback(async (algo) => {
    if (!selectedDataset) return;
    setRunningAlgos(prev => new Set(prev).add(algo));
    const rowId = `${algo}-${Date.now()}`;
    const startedAt = Date.now();
    setBenchmarkResults(prev => [...prev, {
      id: rowId,
      datasetId: selectedDataset.id,
      algo: algo.toUpperCase(),
      buildTime: "—",
      memory: "—",
      accuracy: "—",
      status: "Processing",
      startedAt,
    }]);

    try {
      const result = await pointCloud.benchmarks.run(selectedDataset.id, algo);
      const finalTime = result.build_time_ms != null ? Number(result.build_time_ms) : null;
      const memMB = result.memory_mb != null ? Number(result.memory_mb) : null;
      const acc = result.accuracy_pct != null ? Number(result.accuracy_pct) : null;

      setBenchmarkResults(prev => prev.map(r =>
        r.id === rowId
          ? {
              ...r,
              buildTime: finalTime != null ? `${finalTime} ms` : "—",
              memory: memMB != null ? `${memMB} MB` : "—",
              accuracy: acc != null ? `${acc}%` : "—",
              status: (result.status || "completed").charAt(0).toUpperCase() + (result.status || "completed").slice(1),
            }
          : r
      ));
      loadDatasetBenchmarks();
      if (settings.notifications && finalTime != null) {
        toast({ title: "Benchmark complete", description: `${algo.toUpperCase()} finished — ${finalTime} ms` });
      }
    } catch (error) {
      setBenchmarkResults(prev => prev.map(r =>
        r.id === rowId ? { ...r, status: "Failed" } : r
      ));
      toast({ title: "Benchmark failed", description: String(error?.message || error) });
    } finally {
      setRunningAlgos(prev => { const s = new Set(prev); s.delete(algo); return s; });
    }
  }, [selectedDataset, loadDatasetBenchmarks, settings.notifications]);

  const handleRunAll = useCallback(() => {
    ALGORITHMS.forEach(a => handleRun(a.id));
  }, [handleRun]);

  if (userLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-cyan" />
      </div>
    );
  }

  const isAdmin = user?.role === "admin";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background font-inter">
      <Sidebar
        activePage={activePage === "dataset" ? "datasets" : activePage}
        setActivePage={(sectionId) => navigate(`/${sectionId}`)}
        isAdmin={isAdmin}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          title={activePage === "dataset" && selectedDataset ? selectedDataset.name : (PAGE_TITLES[activePage] ?? "Datasets")}
          user={user}
          datasetName={activePage === "dataset" && selectedDataset ? selectedDataset.name : undefined}
          onDatasetsClick={activePage === "dataset" ? () => navigate("/datasets") : undefined}
        />

        <main className="flex-1 overflow-auto">
          {/* ── DATASET DETAIL (single dataset view) ── */}
          {activePage === "dataset" && selectedDataset && (
            <div className="p-4 space-y-4 h-full flex flex-col">
              <div className="flex-1 grid grid-cols-5 gap-4 min-h-0" style={{ minHeight: 0 }}>
                {/* Left: 3D viewport */}
                <div className="col-span-3 flex flex-col gap-4 min-h-0">
                  <div className="flex-1 min-h-0" style={{ minHeight: "260px" }}>
                    <PointCloudViewer cloudType={cloudType} pointCount={selectedDataset?.point_count || 50000} />
                  </div>
                </div>

                {/* Right: dataset card + indexes table */}
                <div className="col-span-2 flex flex-col gap-3 overflow-y-auto">
                  <div className="bg-card border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Dataset</span>
                      <button
                        type="button"
                        onClick={() => navigate("/datasets")}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        ← Back to datasets
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={handleSaveDatasetName}
                        disabled={savingName}
                        className="flex-1 min-w-0 bg-secondary border border-border rounded px-2 py-1 text-sm font-semibold text-cyan focus:outline-none focus:border-primary/50"
                      />
                      {savingName && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                    </div>
                    {selectedDataset.description && (
                      <p className="text-xs text-muted-foreground">{selectedDataset.description}</p>
                    )}
                    <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                      <p>Created: {selectedDataset.created_date ? new Date(selectedDataset.created_date).toLocaleString() : "—"}</p>
                      <p>Updated: {selectedDataset.updated_date ? new Date(selectedDataset.updated_date).toLocaleString() : (selectedDataset.created_date ? new Date(selectedDataset.created_date).toLocaleString() : "—")}</p>
                    </div>
                    <div className="pt-2 border-t border-border/50">
                      <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">Comment</label>
                      <textarea
                        value={editingComment}
                        onChange={e => setEditingComment(e.target.value)}
                        onBlur={handleSaveDatasetComment}
                        disabled={savingComment}
                        placeholder="Optional notes…"
                        rows={2}
                        className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-y min-h-[48px]"
                      />
                      {savingComment && <span className="text-[10px] text-muted-foreground">Saving…</span>}
                    </div>
                  </div>

                  <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Indexes</h3>
                      <button
                        onClick={handleRunAll}
                        disabled={runningAlgos.size > 0}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-cyan text-background hover:brightness-110 disabled:opacity-50"
                      >
                        <Play className="w-3 h-3" /> Run all
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            {["Algorithm", "Build Time", "Memory", "Accuracy", "Status", ""].map(col => (
                              <th key={col} className="px-3 py-2 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ALGORITHMS.map(({ id: algoId }) => {
                            const row = getRowForAlgo(algoId);
                            const isRunning = runningAlgos.has(algoId);
                            return (
                              <tr key={algoId} className="border-b border-border/50 hover:bg-secondary/50">
                                <td className="px-3 py-2 font-medium text-foreground">{row.algo}</td>
                                <td className="px-3 py-2 font-mono text-cyan">{row.buildTime}</td>
                                <td className="px-3 py-2 font-mono text-muted-foreground">{row.memory}</td>
                                <td className="px-3 py-2 font-mono text-lime">{row.accuracy}</td>
                                <td className="px-3 py-2">
                                  {row.status !== "—" ? (
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                      row.status === "Completed" ? "bg-lime/10 text-lime border-lime/20" :
                                      row.status === "Processing" ? "bg-yellow-400/10 text-yellow-400 border-yellow-400/20" :
                                      "bg-muted/50 text-muted-foreground border-border"
                                    }`}>{row.status}</span>
                                  ) : "—"}
                                </td>
                                <td className="px-3 py-2 w-16">
                                  <button
                                    onClick={() => handleRun(algoId)}
                                    disabled={isRunning}
                                    className="w-7 h-7 rounded flex items-center justify-center bg-primary/10 text-cyan border border-primary/20 hover:bg-primary/20 disabled:opacity-50"
                                    title="Run"
                                  >
                                    {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── OTHER PAGES ── */}
          {activePage === "datasets" && (
            <DatasetsPage
              user={user}
              onNavigateToBenchmark={(ds) => { navigate(`/dataset/${ds.id}`); }}
              onNavigateToVisualize={(ds) => { navigate(`/dataset/${ds.id}`); }}
              onNavigateToDataset={(ds) => { navigate(`/dataset/${ds.id}`); }}
            />
          )}
          {activePage === "benchmarks" && (
            <BenchmarksPage
              user={user}
              initialDataset={undefined}
              initialBenchmarkId={benchmarkId}
              onBackToList={() => navigate("/benchmarks")}
            />
          )}
          {activePage === "spatial" && (
            <div className="p-6 max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Spatial range search</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Set bounds for X, Y, Z and run a range query. Index vs brute-force timing is compared.</p>
              </div>
              <div className="bg-card border border-border rounded-lg p-4 space-y-4">
                <div>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Dataset</span>
                  <div className="mt-2">
                    <DatasetPicker
                      datasets={savedDatasets}
                      selectedId={selectedDataset?.id}
                      onSelect={handleSelectDataset}
                      placeholder="No datasets. Create one from All Datasets."
                    />
                  </div>
                  {selectedDataset && (
                    <p className="text-[10px] text-cyan mt-1.5 font-mono">{selectedDataset.name} · {selectedDataset.point_count?.toLocaleString()} pts</p>
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Index</span>
                  <div className="mt-2">
                    {!selectedDataset && (
                      <p className="text-[10px] text-muted-foreground">Select a dataset first.</p>
                    )}
                    {selectedDataset && spatialIndexesLoading && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading indexes…
                      </p>
                    )}
                    {selectedDataset && !spatialIndexesLoading && spatialIndexes.length === 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        No completed indexes for this dataset yet. Run benchmarks first.
                      </p>
                    )}
                    {selectedDataset && !spatialIndexesLoading && spatialIndexes.length > 0 && (
                      <div className="relative max-w-xs">
                        <select
                          value={selectedIndexAlgo}
                          onChange={e => {
                            setSelectedIndexAlgo(e.target.value);
                            setRangeQueryResult(null);
                            setRangeQueryError("");
                          }}
                          className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground cursor-pointer focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                        >
                          {spatialIndexes.map(algo => (
                            <option key={algo} value={algo}>
                              {algo.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Range bounds (X, Y, Z)</span>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-2">
                    {RANGE_BOUND_KEYS.map(key => (
                      <div key={key} className="flex items-center gap-2">
                        <label className="text-[10px] text-muted-foreground w-10">{key}</label>
                        <input
                          type="number"
                          step="any"
                          value={rangeBounds[key]}
                          onChange={e => {
                            setRangeBounds(prev => ({ ...prev, [key]: e.target.value }));
                            setRangeQueryResult(null);
                            setRangeQueryError("");
                          }}
                          className="flex-1 bg-secondary border border-border rounded px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleRunRangeQuery}
                  disabled={rangeQueryRunning || !selectedDataset || !selectedIndexAlgo || spatialIndexes.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold bg-cyan text-background hover:brightness-110 disabled:opacity-50 glow-cyan transition-all"
                >
                  {rangeQueryRunning ? <><Loader2 className="w-4 h-4 animate-spin" /> Querying…</> : "Run range query"}
                </button>
                {rangeQueryError && (
                  <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">
                    {rangeQueryError}
                  </p>
                )}
                {rangeQueryResult && (
                  <div className="pt-4 border-t border-border space-y-2 text-xs font-mono">
                    <p className="text-muted-foreground">Points in range: <span className="text-foreground font-semibold">{rangeQueryResult.count.toLocaleString()}</span></p>
                    {rangeQueryResult.emptyResult && (
                      <p className="text-yellow-400">No points matched this range.</p>
                    )}
                    <p className="text-cyan">
                      Index query{rangeQueryResult.algorithm ? ` (${rangeQueryResult.algorithm.toUpperCase()})` : ""}:{" "}
                      <span className="text-foreground">{formatMs(rangeQueryResult.indexTimeMs)} ms</span>
                    </p>
                    <p className="text-muted-foreground">Brute-force: <span className="text-foreground">{formatMs(rangeQueryResult.bruteTimeMs)} ms</span></p>
                    <p className="text-muted-foreground">Index build in request: <span className="text-foreground">{formatMs(rangeQueryResult.indexBuildTimeMs)} ms</span></p>
                    <p className="text-muted-foreground">
                      Verified count: <span className="text-foreground">{rangeQueryResult.indexedCount.toLocaleString()} indexed / {rangeQueryResult.bruteCount.toLocaleString()} brute</span>
                    </p>
                    <p className="text-muted-foreground">
                      Candidates: <span className="text-foreground">{Number(rangeQueryResult.candidateCount ?? 0).toLocaleString()}</span>
                      {" "}· Buckets: <span className="text-foreground">{Number(rangeQueryResult.visitedBucketCount ?? 0).toLocaleString()}/{Number(rangeQueryResult.bucketCount ?? 0).toLocaleString()}</span>
                      {rangeQueryResult.indexKind ? <> · <span className="text-foreground">{rangeQueryResult.indexKind}</span></> : null}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          {activePage === "settings" && <SettingsPage />}
          {activePage === "profile" && <ProfilePage user={user} onUserUpdated={() => pointCloud.auth.me().then(setUser)} />}
          {activePage === "admin" && (
            <AdminPage
              user={user}
              initialUserId={userId}
              onBackToList={() => navigate("/admin")}
            />
          )}
          {activePage === "backup" && <BackupPage user={user} />}
        </main>
      </div>
    </div>
  );
}
