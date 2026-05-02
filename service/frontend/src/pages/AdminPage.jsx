import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { pointCloud } from "@/api/pointCloudClient";
import { Shield, Users, RefreshCw, Loader2, Check, Trash2, UserPlus, Search } from "lucide-react";
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

export default function AdminPage({ user, initialUserId = undefined, onBackToList = undefined }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviting, setInviting] = useState(false);
  const [inviteDone, setInviteDone] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = useState("list"); // list | detail
  const [selectedUser, setSelectedUser] = useState(null);
  const [detailName, setDetailName] = useState("");
  const [detailRole, setDetailRole] = useState("user");
  const [detailComment, setDetailComment] = useState("");
  const [savingDetail, setSavingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [sortBy, setSortBy] = useState("-created_date");
  const [page, setPage] = useState(1);
  const [datasetsForCross, setDatasetsForCross] = useState([]);
  const [crossDatasetsMode, setCrossDatasetsMode] = useState(""); // "" | "0" | "1" | "2" ...

  const PAGE_SIZE = 15;

  const datasetsCountByUser = useMemo(() => {
    const byEmail = {};
    datasetsForCross.forEach(d => {
      const e = (d.created_by || "").toLowerCase();
      if (e) byEmail[e] = (byEmail[e] || 0) + 1;
    });
    return byEmail;
  }, [datasetsForCross]);

  const filteredAndSorted = useMemo(() => {
    let list = [...users];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(u =>
        (u.email || "").toLowerCase().includes(q) ||
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.display_name || "").toLowerCase().includes(q)
      );
    }
    if (filterRole) list = list.filter(u => (u.role || "user") === filterRole);
    if (crossDatasetsMode !== "") {
      const n = parseInt(crossDatasetsMode, 10);
      if (isNaN(n) || n === 0) {
        list = list.filter(u => (datasetsCountByUser[(u.email || "").toLowerCase()] || 0) === 0);
      } else {
        list = list.filter(u => (datasetsCountByUser[(u.email || "").toLowerCase()] || 0) >= n);
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
  }, [users, searchQuery, filterRole, sortBy, crossDatasetsMode, datasetsCountByUser]);

  const totalFiltered = filteredAndSorted.length;
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredAndSorted.slice(start, start + PAGE_SIZE);
  }, [filteredAndSorted, page]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  const load = async () => {
    setLoading(true);
    const data = await pointCloud.entities.User.list("-created_date", 500);
    setUsers(data);
    if (selectedUser) {
      const updated = data.find(u => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!initialUserId) {
      setView("list");
      setSelectedUser(null);
      return;
    }
    if (!pointCloud.entities.User.get) return;
    pointCloud.entities.User.get(initialUserId).then((u) => {
      if (u) {
        setSelectedUser(u);
        setDetailName(u.full_name || u.display_name || "");
        setDetailRole(u.role || "user");
        setDetailComment(u.comment ?? "");
        setView("detail");
      }
    });
  }, [initialUserId]);

  useEffect(() => {
    pointCloud.entities.Dataset.filter({}, "-created_date", 1000).then(setDatasetsForCross);
  }, []);

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    const exists = users.some(u => u.email?.toLowerCase() === email.toLowerCase());
    if (exists) {
      setInviteError("User with this email already exists.");
      return;
    }
    setInviteError("");
    setInviting(true);
    try {
      await pointCloud.users.inviteUser(email, inviteRole);
      setInviteDone(true);
      setInviteEmail("");
      setTimeout(() => setInviteDone(false), 2000);
      await load();
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    await pointCloud.entities.User.update(userId, { role: newRole });
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await pointCloud.entities.User.delete(deleteTarget.id);
    setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
    setDeleting(false);
    setDeleteTarget(null);
  };

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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-4 h-4 text-yellow-400" /> Admin Panel
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{totalFiltered} users</p>
        </div>
        <button onClick={load} className="w-8 h-8 rounded-md bg-secondary border border-border flex items-center justify-center hover:border-primary/40 transition-colors">
          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {view === "list" && (
        <>
          {/* Invite user */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <UserPlus className="w-3 h-3" /> Invite User
            </h3>
            <div className="flex gap-2">
              <input
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteError(""); }}
                onKeyDown={e => e.key === "Enter" && handleInvite()}
                placeholder="user@example.com"
                className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-cyan text-background text-xs font-semibold glow-cyan hover:brightness-110 disabled:opacity-50 transition-all whitespace-nowrap"
              >
                {inviting ? <Loader2 className="w-3 h-3 animate-spin" /> : inviteDone ? <Check className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                {inviteDone ? "Invited!" : "Send Invite"}
              </button>
            </div>
            {inviteError && (
              <p className="text-[10px] text-destructive mt-1">{inviteError}</p>
            )}
          </div>

          {!loading && users.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                  placeholder="Search by email or name…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                />
              </div>
              <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1); }} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
                <option value="">All roles</option>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
                <option value="-created_date">Newest first</option>
                <option value="created_date">Oldest first</option>
                <option value="email">Email A–Z</option>
                <option value="-email">Email Z–A</option>
              </select>
              <div className="flex items-center gap-1.5 border-l border-border pl-2">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">Datasets:</span>
                <select value={crossDatasetsMode} onChange={e => { setCrossDatasetsMode(e.target.value); setPage(1); }} className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
                  <option value="">Any</option>
                  <option value="0">0 (none)</option>
                  <option value="1">≥ 1</option>
                  <option value="2">≥ 2</option>
                  <option value="5">≥ 5</option>
                </select>
              </div>
            </div>
          )}

          {/* Users table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">All Users</h3>
            </div>
            {loading ? (
              <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-cyan" /></div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["User", "Email", "Role", "Joined", ""].map(col => (
                      <th key={col} className="px-4 py-2.5 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(u => (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/user/${u.id}`)}
                          className="flex items-center gap-2 w-full text-left hover:text-cyan"
                        >
                          <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-cyan">{(u.full_name || u.email || "?")[0].toUpperCase()}</span>
                          </div>
                          <span className="font-medium text-foreground">{u.full_name || u.display_name || "—"}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.id === user?.id ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 border border-yellow-400/20 font-semibold uppercase">{u.role || "admin"}</span>
                        ) : (
                          <select
                            value={u.role || "user"}
                            onChange={e => handleRoleChange(u.id, e.target.value)}
                            className="bg-secondary border border-border rounded px-2 py-0.5 text-[10px] text-foreground focus:outline-none focus:border-primary/50 uppercase"
                          >
                            <option value="user">USER</option>
                            <option value="admin">ADMIN</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-[10px]">
                        {u.created_date ? new Date(u.created_date).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 w-10">
                        {u.id !== user?.id && (
                          <button
                            onClick={() => setDeleteTarget(u)}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20 transition-colors"
                            title="Delete user"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loading && totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-2 border-t border-border">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-muted-foreground font-mono">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded-md text-xs bg-secondary border border-border hover:border-primary/40 disabled:opacity-50 disabled:pointer-events-none">Next</button>
              </div>
            )}
          </div>
        </>
      )}

      {view === "detail" && selectedUser && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-4 max-w-xl">
          <button
            type="button"
            onClick={() => onBackToList ? onBackToList() : setView("list")}
            className="text-[10px] text-muted-foreground hover:text-foreground mb-1"
          >
            ← Back to users
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="text-xs font-bold text-cyan">{(selectedUser.full_name || selectedUser.email || "?")[0].toUpperCase()}</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{selectedUser.full_name || selectedUser.display_name || selectedUser.email}</p>
              <p className="text-xs text-muted-foreground font-mono">{selectedUser.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Display Name</p>
              <input
                type="text"
                value={detailName}
                onChange={e => setDetailName(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Role</p>
              <select
                value={detailRole}
                onChange={e => setDetailRole(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50 uppercase"
              >
                <option value="user">USER</option>
                <option value="admin">ADMIN</option>
              </select>
            </div>
            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Created at</p>
              <p className="mt-0.5 font-mono">
                {selectedUser.created_date ? new Date(selectedUser.created_date).toLocaleString() : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Updated at</p>
              <p className="mt-0.5 font-mono">
                {selectedUser.updated_date
                  ? new Date(selectedUser.updated_date).toLocaleString()
                  : (selectedUser.created_date ? new Date(selectedUser.created_date).toLocaleString() : "—")}
              </p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Comment</p>
            <textarea
              value={detailComment}
              onChange={e => setDetailComment(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
              className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-y min-h-[48px]"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={async () => {
                if (!selectedUser) return;
                setSavingDetail(true);
                try {
                  const payload = {
                    full_name: detailName.trim() || undefined,
                    role: detailRole,
                    comment: detailComment,
                  };
                  const updated = await pointCloud.entities.User.update(selectedUser.id, payload);
                  setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
                  setSelectedUser(updated);
                } finally {
                  setSavingDetail(false);
                }
              }}
              disabled={savingDetail}
              className="px-4 py-1.5 rounded-md bg-cyan text-background text-xs font-semibold hover:brightness-110 disabled:opacity-50"
            >
              {savingDetail ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save changes"}
            </button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {deleteTarget?.email ?? deleteTarget?.full_name ?? "this user"} from the system? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}