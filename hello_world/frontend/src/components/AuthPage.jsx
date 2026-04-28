import React, { useState } from "react";

export default function AuthPage({ onLogin, onRegister, error }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLocalError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await onLogin(email.trim(), password);
      } else {
        await onRegister(email.trim(), password, fullName.trim());
      }
    } catch (err) {
      setLocalError(err?.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-lg p-6 space-y-5">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {mode === "login"
              ? "Use your email and password to continue."
              : "Register a new account in this app."}
          </p>
        </div>

        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 py-2 text-xs font-medium ${
              mode === "login" ? "bg-primary/10 text-cyan" : "bg-secondary text-muted-foreground"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`flex-1 py-2 text-xs font-medium ${
              mode === "register" ? "bg-primary/10 text-cyan" : "bg-secondary text-muted-foreground"
            }`}
          >
            Register
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <input
              type="text"
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
          />
          {(error?.message || localError) && (
            <p className="text-xs text-destructive">{localError || error.message}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-md bg-cyan text-background text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

      </div>
    </div>
  );
}
