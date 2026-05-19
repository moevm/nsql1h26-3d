import React, { useState, useRef } from "react";
import { Sparkles, Upload, Loader2, Check } from "lucide-react";
import { pointCloud } from "@/api/pointCloudClient";
import { useSettings } from "@/lib/SettingsContext";

const GENERATORS = [
  { id: "generated_sphere", label: "Sphere", description: "Uniform sphere surface", icon: "⚪" },
  { id: "generated_torus", label: "Torus Knot", description: "Parametric torus knot", icon: "🔁" },
  { id: "generated_random", label: "Random Scatter", description: "Uniform random 3D scatter", icon: "✦" },
  { id: "generated_plane", label: "Terrain Plane", description: "Perlin-noise terrain surface", icon: "🏔" },
];

const POINT_COUNTS = [5000, 10000, 25000, 50000, 100000, 250000];

export default function DatasetCreateMenu({ onSelect, onCreated }) {
  const { settings } = useSettings();
  const [tab, setTab] = useState("generate");
  const [genType, setGenType] = useState("generated_sphere");
  const [ptCount, setPtCount] = useState(50000);
  const [dsName, setDsName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef(null);

  const handleGenerate = async () => {
    if (!settings.autoSave && !window.confirm("Auto Save is off. Save this dataset to the cloud?")) return;
    setSaving(true);
    const name = dsName.trim() || `${GENERATORS.find(g => g.id === genType)?.label} ${ptCount.toLocaleString()}pts`;
    const ds = await pointCloud.entities.Dataset.create({
      name,
      source: genType,
      point_count: ptCount,
      is_public: false,
    });
    setSaving(false);
    setDsName("");
    onCreated?.(ds);
    onSelect(ds);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setUploadError("Only .csv files are supported");
      setUploadedFile(null);
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const { file_url, point_count } = await pointCloud.integrations.Core.UploadFile({ file });
      setUploadedFile({ file_url, name: file.name });
      if (typeof point_count === "number" && point_count > 0) {
        setPtCount(point_count);
      }
    } catch (err) {
      setUploadError(err?.message || "File upload failed");
      setUploadedFile(null);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveUploaded = async () => {
    if (!uploadedFile) return;
    if (!settings.autoSave && !window.confirm("Auto Save is off. Save this dataset to the cloud?")) return;
    setSaving(true);
    const name = dsName.trim() || uploadedFile.name;
    const ds = await pointCloud.entities.Dataset.create({
      name,
      source: "uploaded",
      point_count: ptCount,
      file_url: uploadedFile.file_url,
      file_name: uploadedFile.name,
      is_public: false,
    });
    setSaving(false);
    setDsName("");
    setUploadedFile(null);
    onCreated?.(ds);
    onSelect(ds);
  };

  const tabs = [
    { id: "generate", label: "Generate", icon: Sparkles },
    { id: "upload", label: "Upload File", icon: Upload },
  ];

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              tab === id
                ? "text-cyan border-b-2 border-cyan bg-primary/5"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-3">
        {tab === "generate" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {GENERATORS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setGenType(g.id)}
                  className={`flex items-start gap-2 p-2.5 rounded-md border text-left transition-all ${
                    genType === g.id
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-secondary/50 hover:border-border/80"
                  }`}
                >
                  <span className="text-lg leading-none mt-0.5">{g.icon}</span>
                  <div>
                    <p className={`text-xs font-semibold ${genType === g.id ? "text-cyan" : "text-foreground"}`}>{g.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{g.description}</p>
                  </div>
                  {genType === g.id && <Check className="w-3 h-3 text-cyan ml-auto flex-shrink-0 mt-0.5" />}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Point Count</label>
              <div className="flex gap-1.5 flex-wrap">
                {POINT_COUNTS.map(n => (
                  <button
                    key={n}
                    onClick={() => setPtCount(n)}
                    className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                      ptCount === n
                        ? "bg-cyan/20 text-cyan border border-cyan/30"
                        : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {n >= 1000 ? `${n / 1000}K` : n}
                  </button>
                ))}
              </div>
            </div>

            <input
              value={dsName}
              onChange={e => setDsName(e.target.value)}
              placeholder="Dataset name (optional)"
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />

            <button
              onClick={handleGenerate}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold bg-cyan text-background hover:brightness-110 disabled:opacity-50 glow-cyan transition-all"
            >
              {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : <><Sparkles className="w-3 h-3" /> Generate & Load</>}
            </button>
          </>
        )}

        {tab === "upload" && (
          <>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/40 transition-colors"
            >
              {uploading ? (
                <Loader2 className="w-6 h-6 animate-spin text-cyan mx-auto mb-2" />
              ) : uploadedFile ? (
                <Check className="w-6 h-6 text-lime mx-auto mb-2" />
              ) : (
                <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              )}
              <p className="text-xs text-foreground font-medium">
                {uploadedFile ? uploadedFile.name : "Click to upload"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">Only .csv files are supported</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
            </div>

            {uploadedFile && (
              <>
                {uploadError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 mb-3">{uploadError}</div>
                ) : null}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Approx. Point Count</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {POINT_COUNTS.map(n => (
                      <button key={n} onClick={() => setPtCount(n)}
                        className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${ptCount === n ? "bg-cyan/20 text-cyan border border-cyan/30" : "bg-secondary border border-border text-muted-foreground hover:text-foreground"}`}
                      >{n >= 1000 ? `${n / 1000}K` : n}</button>
                    ))}
                  </div>
                </div>
                <input
                  value={dsName}
                  onChange={e => setDsName(e.target.value)}
                  placeholder="Dataset name (optional)"
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                />
                <button onClick={handleSaveUploaded} disabled={saving || !!uploadError}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold bg-cyan text-background hover:brightness-110 disabled:opacity-50 glow-cyan"
                >
                  {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save & Load Dataset"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
