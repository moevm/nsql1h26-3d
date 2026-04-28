import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { pointCloud } from "@/api/pointCloudClient";
import { RefreshCw, Search } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const STATUS_COLORS = {
  completed: "bg-lime/10 text-lime border-lime/20",
  processing: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20",
  queued: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const SORT_OPTIONS = [
  { value: "-created_date", label: "Newest first" },
  { value: "created_date", label: "Oldest first" },
  { value: "algorithm", label: "Algorithm A–Z" },
  { value: "-build_time_ms", label: "Build time high" },
];
const PAGE_SIZE = 20;

export default function BenchmarksPage({ user, initialDataset, initialBenchmarkId, onBackToList }) {
  const navigate = useNavigate();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [datasetQuery, setDatasetQuery] = useState("");
  const [filterAlgorithm, setFilterAlgorithm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sortBy, setSortBy] = useState("-created_date");
  const [page, setPage] = useState(1);
  const [selectedResult, setSelectedResult] = useState(null);
  const [editingComment, setEditingComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [statusHistoryEvents, setStatusHistoryEvents] = useState([]);
  const [statusHistoryLoading, setStatusHistoryLoading] = useState(false);
  const [listView, setListView] = useState("results");
  const [historyToStatus, setHistoryToStatus] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);
  const [historySearchDone, setHistorySearchDone] = useState(false);

  const load = async () => {
    setLoading(true);
    const filter = user?.role === "admin" ? {} : { created_by: user?.email };
    const data = await pointCloud.entities.BenchmarkResult.filter(filter, "-created_date", 500);
    const byId = new Map();
    data.forEach((r) => byId.set(r.id, r));
    setResults(Array.from(byId.values()));
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if (!initialBenchmarkId || !pointCloud.entities.BenchmarkResult.get) return;
    pointCloud.entities.BenchmarkResult.get(initialBenchmarkId).then((r) => {
      if (r) setSelectedResult(r);
    });
  }, [initialBenchmarkId]);

  const filteredAndSorted = useMemo(() => {
    let list = [...results];
    const q = datasetQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(r => (r.dataset_name || "").toLowerCase().includes(q));
    }
    if (filterAlgorithm) list = list.filter(r => (r.algorithm || "").toLowerCase() === filterAlgorithm.toLowerCase());
    if (filterStatus) list = list.filter(r => (r.status || "").toLowerCase() === filterStatus.toLowerCase());
    const desc = sortBy.startsWith("-");
    const key = desc ? sortBy.slice(1) : sortBy;
    list.sort((a, b) => {
      const va = a[key] ?? (key === "build_time_ms" ? 0 : "");
      const vb = b[key] ?? (key === "build_time_ms" ? 0 : "");
      if (typeof va === "number" && typeof vb === "number") return desc ? vb - va : va - vb;
      if (typeof va === "string" && typeof vb === "string") return desc ? vb.localeCompare(va) : va.localeCompare(vb);
      return 0;
    });
    return list;
  }, [results, datasetQuery, filterAlgorithm, filterStatus, sortBy]);

  const totalFiltered = filteredAndSorted.length;
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredAndSorted.slice(start, start + PAGE_SIZE);
  }, [filteredAndSorted, page]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  useEffect(() => {
    if (selectedResult) setEditingComment(selectedResult.comment ?? "");
  }, [selectedResult]);

  useEffect(() => {
    if (!selectedResult || !pointCloud.entities.BenchmarkResultStatusEvent) {
      setStatusHistoryEvents([]);
      return;
    }
    setStatusHistoryLoading(true);
    pointCloud.entities.BenchmarkResultStatusEvent
      .filter({ result_id: selectedResult.id }, "-created_date", 50)
      .then(setStatusHistoryEvents)
      .catch(() => setStatusHistoryEvents([]))
      .finally(() => setStatusHistoryLoading(false));
  }, [selectedResult]);

  const handleSaveComment = useCallback(async () => {
    if (!selectedResult || editingComment === (selectedResult.comment ?? "")) return;
    setSavingComment(true);
    const updated = await pointCloud.entities.BenchmarkResult.update(selectedResult.id, { comment: editingComment });
    setResults(prev => prev.map(r => r.id === updated.id ? updated : r));
    setSelectedResult(updated);
    setSavingComment(false);
  }, [selectedResult, editingComment]);

  const runHistorySearch = useCallback(async () => {
    if (!pointCloud.entities.BenchmarkResultStatusEvent) return;
    setHistorySearchLoading(true);
    setHistorySearchDone(false);
    const filter = historyToStatus ? { to_status: historyToStatus } : {};
    pointCloud.entities.BenchmarkResultStatusEvent
      .filter(filter, "-created_date", 300)
      .then((events) => {
        let list = events;
        if (historyDateFrom) {
          const from = new Date(historyDateFrom).getTime();
          list = list.filter((e) => new Date(e.created_date).getTime() >= from);
        }
        if (historyDateTo) {
          const to = new Date(historyDateTo).getTime() + 86400000;
          list = list.filter((e) => new Date(e.created_date).getTime() < to);
        }
        setHistoryEvents(list);
      })
      .catch(() => setHistoryEvents([]))
      .finally(() => {
        setHistorySearchLoading(false);
        setHistorySearchDone(true);
      });
  }, [historyToStatus, historyDateFrom, historyDateTo]);

  const historyEventsWithResult = useMemo(() => {
    return historyEvents
      .map((ev) => ({ ...ev, result: results.find((r) => r.id === ev.result_id) }))
      .filter((e) => e.result);
  }, [historyEvents, results]);

  const ALGO_COLORS = { kdtree: "hsl(185 100% 50%)", octree: "hsl(150 80% 45%)", bvh: "hsl(280 70% 65%)", lsh: "hsl(45 100% 55%)" };
  const completed = results.filter(r => r.status === "completed" && r.build_time_ms);
  const chartData = completed.map((r, i) => ({
    name: `#${i + 1}`,
    [r.algorithm]: r.build_time_ms,
  }));
  const usedAlgos = [...new Set(completed.map(r => r.algorithm))];
  const algorithms = [...new Set(results.map(r => r.algorithm).filter(Boolean))];

  if (selectedResult) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <button
          type="button"
          onClick={() => {
            setSelectedResult(null);
            if (onBackToList) onBackToList();
          }}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          ← Back to results
        </button>
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {(selectedResult.algorithm || "").toUpperCase()} · {selectedResult.dataset_name || selectedResult.dataset_id || "—"}
            </h3>
            <span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_COLORS[selectedResult.status] || STATUS_COLORS.queued}`}>
              {(selectedResult.status || "").charAt(0).toUpperCase() + (selectedResult.status || "").slice(1)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-[10px] text-muted-foreground uppercase">Build time</span><p className="font-mono text-cyan">{selectedResult.build_time_ms != null ? `${selectedResult.build_time_ms} ms` : "—"}</p></div>
            <div><span className="text-[10px] text-muted-foreground uppercase">Memory</span><p className="font-mono">{selectedResult.memory_mb != null ? `${selectedResult.memory_mb} MB` : "—"}</p></div>
            <div><span className="text-[10px] text-muted-foreground uppercase">Accuracy</span><p className="font-mono text-lime">{selectedResult.accuracy_pct != null ? `${selectedResult.accuracy_pct}%` : "—"}</p></div>
            <div><span className="text-[10px] text-muted-foreground uppercase">Points</span><p className="font-mono">{selectedResult.point_count != null ? selectedResult.point_count.toLocaleString() : "—"}</p></div>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
            <p>Created: {selectedResult.created_date ? new Date(selectedResult.created_date).toLocaleString() : "—"}</p>
            <p>Updated: {selectedResult.updated_date ? new Date(selectedResult.updated_date).toLocaleString() : (selectedResult.created_date ? new Date(selectedResult.created_date).toLocaleString() : "—")}</p>
          </div>
          <div>
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">Comment</label>
            <textarea
              value={editingComment}
              onChange={e => setEditingComment(e.target.value)}
              onBlur={handleSaveComment}
              disabled={savingComment}
              placeholder="Optional notes…"
              rows={2}
              className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-y min-h-[48px]"
            />
            {savingComment && <span className="text-[10px] text-muted-foreground">Saving…</span>}
          </div>
          {pointCloud.entities.BenchmarkResultStatusEvent && (
            <div className="border-t border-border pt-4">
              <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Status history</h4>
              {statusHistoryLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : statusHistoryEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {selectedResult.created_date
                    ? `Created → ${(selectedResult.status || "").charAt(0).toUpperCase() + (selectedResult.status || "").slice(1)} (${new Date(selectedResult.created_date).toLocaleString()})`
                    : "No history"}
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left font-mono text-[10px] text-muted-foreground uppercase py-1">Date</th>
                      <th className="text-left font-mono text-[10px] text-muted-foreground uppercase py-1">From → To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusHistoryEvents.map((ev) => (
                      <tr key={ev.id} className="border-b border-border/50">
                        <td className="py-1.5 font-mono text-muted-foreground">{ev.created_date ? new Date(ev.created_date).toLocaleString() : "—"}</td>
                        <td className="py-1.5">
                          <span className="text-muted-foreground">{(ev.from_status || "—")}</span>
                          <span className="mx-1">→</span>
                          <span className="font-medium">{(ev.to_status || "").charAt(0).toUpperCase() + (ev.to_status || "").slice(1)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Benchmark Results</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{totalFiltered} runs · click row for details</p>
        </div>
        <div className="flex items-center gap-2">
          {pointCloud.entities.BenchmarkResultStatusEvent && (
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setListView("results")}
                className={`px-3 py-1.5 text-xs font-medium ${listView === "results" ? "bg-primary/10 text-cyan border-primary/20" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              >
                Results
              </button>
              <button
                type="button"
                onClick={() => setListView("history")}
                className={`px-3 py-1.5 text-xs font-medium ${listView === "history" ? "bg-primary/10 text-cyan border-primary/20" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              >
                Status history
              </button>
            </div>
          )}
          <button onClick={load} className="w-8 h-8 rounded-md bg-secondary border border-border flex items-center justify-center hover:border-primary/40 transition-colors">
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {listView === "history" && pointCloud.entities.BenchmarkResultStatusEvent && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Search by status history</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-0.5">Transition to</label>
              <select value={historyToStatus} onChange={(e) => setHistoryToStatus(e.target.value)} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
                <option value="">Any</option>
                {["completed", "processing", "queued", "failed"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-0.5">From date</label>
              <input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-0.5">To date</label>
              <input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50" />
            </div>
            <button onClick={runHistorySearch} disabled={historySearchLoading} className="px-3 py-1.5 rounded-md bg-cyan text-background text-xs font-semibold hover:brightness-110 disabled:opacity-50">
              {historySearchLoading ? "Searching…" : "Search"}
            </button>
          </div>
          {historySearchLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : !historySearchDone ? (
            <p className="text-xs text-muted-foreground">Set filters and click Search. Click a row to open result.</p>
          ) : historyEventsWithResult.length === 0 ? (
            <p className="text-xs text-muted-foreground">No events match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 py-1.5 text-left font-mono text-[10px] text-muted-foreground uppercase">Date</th>
                    <th className="px-2 py-1.5 text-left font-mono text-[10px] text-muted-foreground uppercase">Result</th>
                    <th className="px-2 py-1.5 text-left font-mono text-[10px] text-muted-foreground uppercase">From → To</th>
                  </tr>
                </thead>
                <tbody>
                  {historyEventsWithResult.map((ev) => (
                    <tr
                      key={ev.id}
                      onClick={() => navigate(`/benchmark/${ev.result.id}`)}
                      className="border-b border-border/50 hover:bg-secondary/50 cursor-pointer"
                    >
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">{ev.created_date ? new Date(ev.created_date).toLocaleString() : "—"}</td>
                      <td className="px-2 py-1.5 text-foreground">{(ev.result.algorithm || "").toUpperCase()} · {ev.result.dataset_name || "—"}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-muted-foreground">{(ev.from_status || "—")}</span>
                        <span className="mx-1">→</span>
                        <span className="font-medium">{(ev.to_status || "").charAt(0).toUpperCase() + (ev.to_status || "").slice(1)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {listView === "results" && !loading && results.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={datasetQuery}
              onChange={e => { setDatasetQuery(e.target.value); setPage(1); }}
              placeholder="Dataset name contains…"
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <select value={filterAlgorithm} onChange={e => { setFilterAlgorithm(e.target.value); setPage(1); }} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
            <option value="">All algorithms</option>
            {algorithms.map(a => (<option key={a} value={a}>{(a || "").toUpperCase()}</option>))}
          </select>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
            <option value="">All statuses</option>
            {["completed", "processing", "queued", "failed"].map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
          <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
            {SORT_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </div>
      )}

      {listView === "results" && (
      <>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Runs", value: results.length, color: "text-cyan" },
          { label: "Completed", value: results.filter(r => r.status === "completed").length, color: "text-lime" },
          { label: "Processing", value: results.filter(r => r.status === "processing").length, color: "text-yellow-400" },
          { label: "Failed", value: results.filter(r => r.status === "failed").length, color: "text-destructive" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Build Time by Run</h3>
            <span className="text-[10px] font-mono text-cyan/60">ms</span>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 15% 18%)" />
                <XAxis dataKey="name" tick={{ fill: "hsl(215 20% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(215 20% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(222 20% 11%)", border: "1px solid hsl(222 15% 18%)", borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} iconType="circle" iconSize={7} />
                {usedAlgos.map(algo => (
                  <Line key={algo} type="monotone" dataKey={algo} stroke={ALGO_COLORS[algo] || "#888"} strokeWidth={2} dot={{ r: 3 }} name={algo.toUpperCase()} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-32 rounded-lg bg-card border border-border animate-pulse" />
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["Algorithm", "Dataset", "Build Time", "Memory", "Accuracy", "Status"].map(col => (
                    <th key={col} className="px-4 py-2.5 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No results match filters.</td></tr>
                ) : (
                  paginated.map((r, idx) => (
                    <tr
                      key={`${r.id}-${idx}`}
                      data-result-id={r.id}
                      onClick={(e) => {
                        const row = e.currentTarget;
                        const id = row.getAttribute("data-result-id");
                        const result = results.find((x) => x.id === id);
                        if (result) navigate(`/benchmark/${result.id}`);
                      }}
                      className="border-b border-border/50 hover:bg-secondary/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{(r.algorithm || "").toUpperCase()}</td>
                      <td className="px-4 py-3 text-muted-foreground truncate max-w-[120px]" title={r.dataset_name}>{r.dataset_name || "—"}</td>
                      <td className="px-4 py-3 font-mono text-cyan">{r.build_time_ms != null ? `${r.build_time_ms} ms` : "—"}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{r.memory_mb != null ? `${r.memory_mb} MB` : "—"}</td>
                      <td className="px-4 py-3 font-mono text-lime">{r.accuracy_pct != null ? `${r.accuracy_pct}%` : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${STATUS_COLORS[r.status] || STATUS_COLORS.queued}`}>
                          {(r.status || "").charAt(0).toUpperCase() + (r.status || "").slice(1)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-2 border-t border-border">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Previous</button>
              <span className="text-xs text-muted-foreground font-mono">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Next</button>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}