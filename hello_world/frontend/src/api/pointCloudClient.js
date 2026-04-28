const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "pointcloud_token";

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
    filter: (filter, orderBy, limit) =>
      api(
        `/entities/${name}/filter?filter=${encodeURIComponent(JSON.stringify(filter ?? {}))}&orderBy=${encodeURIComponent(
          orderBy || "-created_date"
        )}&limit=${limit ?? 100}`
      ),
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
  entities: {
    Dataset: entityApi("Dataset"),
    BenchmarkResult: entityApi("BenchmarkResult"),
    BenchmarkResultStatusEvent: entityApi("BenchmarkResultStatusEvent"),
    User: entityApi("User"),
  },
};
