import React from "react";
import { LogOut } from "lucide-react";
import { pointCloud } from "@/api/pointCloudClient";

export default function TopBar({ title, user, datasetName, onDatasetsClick }) {
  const initials = user?.full_name
    ? user.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || "?";

  const isDatasetBreadcrumb = datasetName != null && typeof onDatasetsClick === "function";

  return (
    <header className="h-12 flex-shrink-0 flex items-center justify-between px-5 border-b border-border bg-card/60 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground">~/</span>
        {isDatasetBreadcrumb ? (
          <>
            <button
              type="button"
              onClick={onDatasetsClick}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              Datasets
            </button>
            <span className="text-xs font-mono text-muted-foreground">/</span>
            <h1 className="text-sm font-semibold text-foreground">{datasetName}</h1>
          </>
        ) : (
          <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center" title={user?.email}>
          <span className="text-[10px] font-bold text-cyan">{initials}</span>
        </div>
        <button
          onClick={() => pointCloud.auth.logout()}
          className="w-7 h-7 rounded-md bg-secondary border border-border flex items-center justify-center hover:border-destructive/40 hover:text-destructive transition-colors"
          title="Logout"
        >
          <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
    </header>
  );
}