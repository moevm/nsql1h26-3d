import React, { useState, useEffect } from "react";
import { pointCloud } from "@/api/pointCloudClient";
import { Save, Loader2 } from "lucide-react";

export default function ProfilePage({ user, onUserUpdated }) {
  const [form, setForm] = useState({ display_name: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({ display_name: user.display_name || user.full_name || "" });
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    await pointCloud.auth.updateMe(form);
    setSaving(false);
    setSaved(true);
    onUserUpdated?.();
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">User Profile</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your account details</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center glow-cyan">
          <span className="text-xl font-bold text-cyan">
            {(form.display_name || user?.email || "?")[0]?.toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{user?.full_name || user?.email}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
          <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            user?.role === "admin"
              ? "bg-yellow-400/10 text-yellow-400 border-yellow-400/20"
              : "bg-cyan/10 text-cyan border-cyan/20"
          }`}>
            {user?.role || "user"}
          </span>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Display Name</label>
          <input
            value={form.display_name}
            onChange={e => setForm({ display_name: e.target.value })}
            placeholder="Your display name"
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Email</label>
          <input
            value={user?.email || ""}
            disabled
            className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-cyan text-background text-xs font-semibold glow-cyan hover:brightness-110 disabled:opacity-50 transition-all"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? "✓ Saved" : <><Save className="w-3 h-3" /> Save Changes</>}
        </button>
      </div>
    </div>
  );
}