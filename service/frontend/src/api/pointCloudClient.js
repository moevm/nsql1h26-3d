const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const TOKEN_KEY = "pointcloud_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const token = getToken();
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body == null ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || "API error");
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function entityApi(name) {
  return {
    list: (orderBy, limit) =>
      api(`/entities/${name}/list?orderBy=${encodeURIComponent(orderBy || "-created_date")}&limit=${limit ?? 100}`),
    filter: (filter, orderBy, limit, skip, options) => {
      const params = new URLSearchParams();
      params.set("filter", JSON.stringify(filter ?? {}));
      params.set("orderBy", orderBy || "-created_date");
      params.set("limit", String(limit ?? 100));
      if (skip != null && skip > 0) params.set("skip", String(skip));
      if (options?.countTotal) params.set("countTotal", "true");
      return api(`/entities/${name}/filter?${params.toString()}`);
    },
    get: (id) => api(`/entities/${name}/${id}`),
    create: (data) => api(`/entities/${name}`, { method: "POST", body: { data } }),
    update: (id, data) => api(`/entities/${name}/${id}`, { method: "PATCH", body: { data } }),
    delete: (id) => api(`/entities/${name}/${id}`, { method: "DELETE" }),
    bulkCreate: (items) => api(`/entities/${name}/bulk`, { method: "POST", body: { items } }),
    deleteMany: () => Promise.resolve(),
  };
}

export const pointCloud = {
  auth: {
    me: async () => api("/auth/me"),
    logout: async () => {
      try {
        await api("/auth/logout", { method: "POST" });
      } finally {
        setToken(null);
      }
    },
    redirectToLogin: async () => {
      setToken(null);
    },
    updateMe: (data) => api("/auth/me", { method: "PATCH", body: data }),
    loginWithPassword: async (email, password) => {
      const res = await api("/auth/login", { method: "POST", body: { email, password } });
      setToken(res.access_token);
      return res.user;
    },
    registerWithPassword: async (email, password, full_name) => {
      const res = await api("/auth/register", {
        method: "POST",
        body: { email, password, full_name },
      });
      setToken(res.access_token);
      return res.user;
    },
  },
  users: {
    inviteUser: (email, role = "user") =>
      api("/users/invite", { method: "POST", body: { email, role } }),
  },
  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        const formData = new FormData();
        formData.append("file", file);
        return api("/files/upload", { method: "POST", body: formData, isForm: true });
      },
    },
  },
  benchmarks: {
    run: (dataset_id, algorithm) =>
      api("/benchmarks/run", {
        method: "POST",
        body: { dataset_id, algorithm },
      }),
  },
  backup: {
    export: () => api("/backup/export", { method: "POST" }),
    importReplace: (payload) => api("/backup/import-replace", { method: "POST", body: payload }),
  },
  datasets: {
    query: (body) => api("/datasets/query", { method: "POST", body }),
  },
  entities: {
    Dataset: entityApi("Dataset"),
    BenchmarkResult: entityApi("BenchmarkResult"),
    BenchmarkResultStatusEvent: entityApi("BenchmarkResultStatusEvent"),
    User: entityApi("User"),
  },
};
