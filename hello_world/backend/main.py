import hashlib
import logging
import os
import secrets
import time
import tracemalloc
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np
from bson import ObjectId
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from hilbertcurve.hilbertcurve import HilbertCurve
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB_NAME", "benchmark_db")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/tmp/uploads"))

app = FastAPI(title="NSQL 0.5 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger = logging.getLogger("uvicorn.error")

client: Optional[AsyncIOMotorClient] = None
db = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def oid_str(item: dict[str, Any]) -> dict[str, Any]:
    if "_id" in item:
        item["id"] = str(item.pop("_id"))
    return item


def hash_password(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def parse_order_by(order_by: Optional[str]) -> tuple[str, int]:
    if not order_by:
        return "created_date", -1
    if order_by.startswith("-"):
        return order_by[1:], -1
    return order_by, 1


def make_filter(payload: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in payload.items():
        if v is None:
            continue
        if isinstance(v, str) and v == "":
            continue
        out[k] = v
    return out


def build_seed_from_dataset(dataset: dict[str, Any]) -> int:
    seed_src = f"{dataset.get('_id')}|{dataset.get('name','')}|{dataset.get('source','')}"
    digest = hashlib.sha256(seed_src.encode("utf-8")).hexdigest()
    return int(digest[:16], 16) % (2**32)


def generate_dataset_points(dataset: dict[str, Any]) -> np.ndarray:
    count = int(dataset.get("point_count") or 10000)
    count = max(1000, min(count, 50000))
    source = (dataset.get("source") or "generated_random").lower()
    rng = np.random.default_rng(build_seed_from_dataset(dataset))

    if source == "generated_sphere":
        phi = rng.uniform(0, 2 * np.pi, count)
        costheta = rng.uniform(-1, 1, count)
        theta = np.arccos(costheta)
        r = rng.normal(1.0, 0.02, count)
        x = r * np.sin(theta) * np.cos(phi)
        y = r * np.sin(theta) * np.sin(phi)
        z = r * np.cos(theta)
        return np.column_stack((x, y, z)).astype(np.float32)

    if source == "generated_plane":
        x = rng.uniform(-1.0, 1.0, count)
        y = rng.uniform(-1.0, 1.0, count)
        z = (0.15 * np.sin(4 * x) * np.cos(4 * y)) + rng.normal(0, 0.02, count)
        return np.column_stack((x, y, z)).astype(np.float32)

    if source == "generated_torus":
        u = rng.uniform(0, 2 * np.pi, count)
        v = rng.uniform(0, 2 * np.pi, count)
        R = 1.0
        r = 0.35
        x = (R + r * np.cos(v)) * np.cos(u)
        y = (R + r * np.cos(v)) * np.sin(u)
        z = r * np.sin(v)
        return np.column_stack((x, y, z)).astype(np.float32)

    return rng.uniform(-1.0, 1.0, (count, 3)).astype(np.float32)


def benchmark_kdtree(points: np.ndarray) -> tuple[Any, Any]:
    sorted_idx = np.argsort(points[:, 0])
    structure = points[sorted_idx]

    def query_fn(q: np.ndarray) -> int:
        d = np.sum((structure - q) ** 2, axis=1)
        return int(sorted_idx[int(np.argmin(d))])

    return structure, query_fn


def benchmark_octree(points: np.ndarray) -> tuple[Any, Any]:
    bins = 16
    scaled = ((points + 1.0) * 0.5 * (bins - 1)).clip(0, bins - 1).astype(np.int32)
    keys = (scaled[:, 0] * bins * bins) + (scaled[:, 1] * bins) + scaled[:, 2]
    buckets: dict[int, list[int]] = {}
    for i, key in enumerate(keys.tolist()):
        buckets.setdefault(key, []).append(i)

    def query_fn(q: np.ndarray) -> int:
        qs = ((q + 1.0) * 0.5 * (bins - 1)).clip(0, bins - 1).astype(np.int32)
        key = int((qs[0] * bins * bins) + (qs[1] * bins) + qs[2])
        candidates = buckets.get(key)
        if not candidates:
            d = np.sum((points - q) ** 2, axis=1)
            return int(np.argmin(d))
        sub = points[candidates]
        d = np.sum((sub - q) ** 2, axis=1)
        return int(candidates[int(np.argmin(d))])

    return buckets, query_fn


def benchmark_balltree(points: np.ndarray) -> tuple[Any, Any]:
    leaf_size = 48

    def build(idxs: np.ndarray) -> dict[str, Any]:
        pts = points[idxs]
        center = np.mean(pts, axis=0)
        radius = float(np.max(np.linalg.norm(pts - center, axis=1)))
        node: dict[str, Any] = {"center": center, "radius": radius}
        if len(idxs) <= leaf_size:
            node["idxs"] = idxs
            return node
        variances = np.var(pts, axis=0)
        axis = int(np.argmax(variances))
        order = idxs[np.argsort(points[idxs, axis])]
        mid = len(order) // 2
        node["left"] = build(order[:mid])
        node["right"] = build(order[mid:])
        return node

    root = build(np.arange(len(points)))

    def query_fn(q: np.ndarray) -> int:
        best_idx = 0
        best_dist = float("inf")
        stack = [root]
        while stack:
            n = stack.pop()
            center_dist = float(np.linalg.norm(n["center"] - q))
            if center_dist - n["radius"] > best_dist:
                continue
            if "idxs" in n:
                idxs = n["idxs"]
                d = np.sum((points[idxs] - q) ** 2, axis=1)
                i = int(np.argmin(d))
                dist = float(np.sqrt(d[i]))
                if dist < best_dist:
                    best_dist = dist
                    best_idx = int(idxs[i])
            else:
                stack.append(n["left"])
                stack.append(n["right"])
        return best_idx

    return root, query_fn


def benchmark_rtree(points: np.ndarray) -> tuple[Any, Any]:
    # Simple R-tree style grouping by sorted tiles
    group_size = 64
    order = np.argsort(points[:, 0] + points[:, 1] * 0.5 + points[:, 2] * 0.25)
    groups = []
    for i in range(0, len(order), group_size):
        idxs = order[i : i + group_size]
        pts = points[idxs]
        mn = np.min(pts, axis=0)
        mx = np.max(pts, axis=0)
        groups.append({"idxs": idxs, "min": mn, "max": mx})

    def min_dist_box(q: np.ndarray, mn: np.ndarray, mx: np.ndarray) -> float:
        clamped = np.minimum(np.maximum(q, mn), mx)
        return float(np.sum((q - clamped) ** 2))

    def query_fn(q: np.ndarray) -> int:
        groups_sorted = sorted(groups, key=lambda g: min_dist_box(q, g["min"], g["max"]))
        best_idx = int(groups_sorted[0]["idxs"][0])
        best = float("inf")
        for g in groups_sorted[:8]:
            idxs = g["idxs"]
            d = np.sum((points[idxs] - q) ** 2, axis=1)
            i = int(np.argmin(d))
            dist = float(d[i])
            if dist < best:
                best = dist
                best_idx = int(idxs[i])
        return best_idx

    return groups, query_fn


def benchmark_bvh(points: np.ndarray) -> tuple[Any, Any]:
    order = np.argsort(points[:, 0] + points[:, 1] * 0.31 + points[:, 2] * 0.17)
    packed = points[order]
    chunk = 64
    nodes = [packed[i : i + chunk] for i in range(0, len(packed), chunk)]

    def query_fn(q: np.ndarray) -> int:
        best_idx = 0
        best_dist = float("inf")
        offset = 0
        for node in nodes:
            if len(node) == 0:
                continue
            node_center = np.mean(node, axis=0)
            center_dist = float(np.sum((node_center - q) ** 2))
            if center_dist > best_dist * 2:
                offset += len(node)
                continue
            d = np.sum((node - q) ** 2, axis=1)
            i = int(np.argmin(d))
            dist = float(d[i])
            if dist < best_dist:
                best_dist = dist
                best_idx = offset + i
            offset += len(node)
        return int(order[best_idx])

    return nodes, query_fn


def benchmark_svo(points: np.ndarray) -> tuple[Any, Any]:
    # Sparse voxel octree-like sparse voxel map
    depth = 8
    bins = 2**depth
    scaled = ((points + 1.0) * 0.5 * (bins - 1)).clip(0, bins - 1).astype(np.int32)
    voxels: dict[tuple[int, int, int], list[int]] = {}
    for i, c in enumerate(scaled.tolist()):
        key = (c[0], c[1], c[2])
        voxels.setdefault(key, []).append(i)

    def query_fn(q: np.ndarray) -> int:
        qs = ((q + 1.0) * 0.5 * (bins - 1)).clip(0, bins - 1).astype(np.int32)
        base = (int(qs[0]), int(qs[1]), int(qs[2]))
        candidates = voxels.get(base, [])
        if not candidates:
            # check neighborhood shells
            for r in (1, 2):
                local = []
                for dx in range(-r, r + 1):
                    for dy in range(-r, r + 1):
                        for dz in range(-r, r + 1):
                            local.extend(voxels.get((base[0] + dx, base[1] + dy, base[2] + dz), []))
                if local:
                    candidates = local
                    break
        if not candidates:
            d = np.sum((points - q) ** 2, axis=1)
            return int(np.argmin(d))
        sub = points[candidates]
        d = np.sum((sub - q) ** 2, axis=1)
        return int(candidates[int(np.argmin(d))])

    return voxels, query_fn


def benchmark_phtree(points: np.ndarray) -> tuple[Any, Any]:
    # PH-tree style integer hypercube addressing
    scale = 4095
    quant = ((points + 1.0) * 0.5 * scale).clip(0, scale).astype(np.int32)
    buckets: dict[tuple[int, int, int], list[int]] = {}
    for i, q in enumerate(quant.tolist()):
        key = (q[0], q[1], q[2])
        buckets.setdefault(key, []).append(i)

    def query_fn(q: np.ndarray) -> int:
        qq = ((q + 1.0) * 0.5 * scale).clip(0, scale).astype(np.int32)
        key = (int(qq[0]), int(qq[1]), int(qq[2]))
        candidates = buckets.get(key, [])
        if not candidates:
            # tiny neighborhood in key-space
            for step in (1, 2, 4):
                local = []
                for dx in (-step, 0, step):
                    for dy in (-step, 0, step):
                        for dz in (-step, 0, step):
                            local.extend(buckets.get((key[0] + dx, key[1] + dy, key[2] + dz), []))
                if local:
                    candidates = local
                    break
        if not candidates:
            d = np.sum((points - q) ** 2, axis=1)
            return int(np.argmin(d))
        sub = points[candidates]
        d = np.sum((sub - q) ** 2, axis=1)
        return int(candidates[int(np.argmin(d))])

    return buckets, query_fn


def _morton3d_codes(points: np.ndarray, bits: int = 10) -> np.ndarray:
    bins = 2**bits
    q = ((points + 1.0) * 0.5 * (bins - 1)).clip(0, bins - 1).astype(np.uint32)

    def part1by2(v: np.ndarray) -> np.ndarray:
        x = v & np.uint32(0x3FF)
        x = (x | (x << 16)) & np.uint32(0x30000FF)
        x = (x | (x << 8)) & np.uint32(0x300F00F)
        x = (x | (x << 4)) & np.uint32(0x30C30C3)
        x = (x | (x << 2)) & np.uint32(0x9249249)
        return x

    return part1by2(q[:, 0]) | (part1by2(q[:, 1]) << 1) | (part1by2(q[:, 2]) << 2)


def benchmark_morton(points: np.ndarray) -> tuple[Any, Any]:
    codes = _morton3d_codes(points, bits=10)
    order = np.argsort(codes)
    ordered_points = points[order]
    ordered_codes = codes[order]

    def query_fn(q: np.ndarray) -> int:
        qc = _morton3d_codes(np.array([q], dtype=np.float32), bits=10)[0]
        pos = int(np.searchsorted(ordered_codes, qc))
        lo = max(0, pos - 64)
        hi = min(len(ordered_codes), pos + 64)
        idxs = np.arange(lo, hi)
        d = np.sum((ordered_points[idxs] - q) ** 2, axis=1)
        i = int(np.argmin(d))
        return int(order[lo + i])

    return order, query_fn


def benchmark_hilbert(points: np.ndarray) -> tuple[Any, Any]:
    bits = 10
    bins = 2**bits
    q = ((points + 1.0) * 0.5 * (bins - 1)).clip(0, bins - 1).astype(np.int32)
    hc = HilbertCurve(bits, 3)
    dists = np.array([hc.distance_from_point([int(a), int(b), int(c)]) for a, b, c in q], dtype=np.int64)
    order = np.argsort(dists)
    ordered_points = points[order]
    ordered_dists = dists[order]

    def query_fn(query: np.ndarray) -> int:
        qq = ((query + 1.0) * 0.5 * (bins - 1)).clip(0, bins - 1).astype(np.int32)
        qd = int(hc.distance_from_point([int(qq[0]), int(qq[1]), int(qq[2])]))
        pos = int(np.searchsorted(ordered_dists, qd))
        lo = max(0, pos - 64)
        hi = min(len(ordered_dists), pos + 64)
        idxs = np.arange(lo, hi)
        d = np.sum((ordered_points[idxs] - query) ** 2, axis=1)
        i = int(np.argmin(d))
        return int(order[lo + i])

    return order, query_fn


def benchmark_lsh(points: np.ndarray) -> tuple[Any, Any]:
    rng = np.random.default_rng(42)
    planes = rng.normal(0, 1, (12, 3)).astype(np.float32)
    projections = points @ planes.T
    signatures = (projections > 0).astype(np.int8)
    keys = np.packbits(signatures, axis=1, bitorder="little")
    buckets: dict[int, list[int]] = {}
    for idx, key in enumerate(keys[:, 0].tolist()):
        buckets.setdefault(int(key), []).append(idx)

    def query_fn(q: np.ndarray) -> int:
        proj = q @ planes.T
        sig = (proj > 0).astype(np.int8)
        key = int(np.packbits(sig, bitorder="little")[0])
        candidates = buckets.get(key)
        if not candidates:
            d = np.sum((points - q) ** 2, axis=1)
            return int(np.argmin(d))
        sub = points[candidates]
        d = np.sum((sub - q) ** 2, axis=1)
        return int(candidates[int(np.argmin(d))])

    return buckets, query_fn


def calc_accuracy(points: np.ndarray, query_fn: Any) -> float:
    if len(points) < 4:
        return 100.0
    rng = np.random.default_rng(7)
    sample_size = min(120, len(points))
    ids = rng.choice(len(points), sample_size, replace=False)
    ok = 0
    for idx in ids.tolist():
        q = points[idx]
        d = np.sum((points - q) ** 2, axis=1)
        gt = int(np.argmin(d))
        pred = int(query_fn(q))
        if pred == gt:
            ok += 1
    return round((ok / sample_size) * 100.0, 1)


def run_algorithm(points: np.ndarray, algorithm: str) -> tuple[float, float, float]:
    algo = (algorithm or "").lower()
    runners = {
        "kdtree": benchmark_kdtree,
        "octree": benchmark_octree,
        "balltree": benchmark_balltree,
        "rtree": benchmark_rtree,
        "bvh": benchmark_bvh,
        "svo": benchmark_svo,
        "phtree": benchmark_phtree,
        "morton": benchmark_morton,
        "hilbert": benchmark_hilbert,
    }
    if algo not in runners:
        raise ValueError(f"Unsupported algorithm: {algorithm}")

    tracemalloc.start()
    t0 = time.perf_counter()
    _structure, query_fn = runners[algo](points)
    build_ms = (time.perf_counter() - t0) * 1000.0
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    memory_mb = peak / (1024 * 1024)
    accuracy_pct = calc_accuracy(points, query_fn)
    return round(build_ms, 1), round(memory_mb, 1), accuracy_pct


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class AuthRegisterRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None


class AuthUpdateMeRequest(BaseModel):
    full_name: Optional[str] = None
    display_name: Optional[str] = None
    comment: Optional[str] = None


class InviteRequest(BaseModel):
    email: str
    role: str = "user"


class EntityMutation(BaseModel):
    data: dict[str, Any]


class BulkMutation(BaseModel):
    items: list[dict[str, Any]]


class ReplaceImportRequest(BaseModel):
    entities: dict[str, list[dict[str, Any]]]


class BenchmarkRunRequest(BaseModel):
    dataset_id: str
    algorithm: str


async def require_user(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    session = await db.sessions.find_one({"token": token})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"_id": ObjectId(session["user_id"])})
    if not user:
        raise HTTPException(status_code=401, detail="Unknown user")
    return oid_str(user)


async def require_admin(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user


async def seed_if_empty() -> None:
    users_count = await db.users.count_documents({})
    if users_count > 0:
        return

    created = now_iso()
    admin = {
        "email": "admin@local.dev",
        "password_hash": hash_password("admin123"),
        "role": "admin",
        "full_name": "Admin User",
        "display_name": "Admin",
        "comment": "Seed admin",
        "created_date": created,
        "updated_date": created,
    }
    user = {
        "email": "user@local.dev",
        "password_hash": hash_password("user123"),
        "role": "user",
        "full_name": "Default User",
        "display_name": "User",
        "comment": "Seed user",
        "created_date": created,
        "updated_date": created,
    }
    admin_id = (await db.users.insert_one(admin)).inserted_id
    user_id = (await db.users.insert_one(user)).inserted_id

    datasets = [
        {
            "name": f"Seed dataset {i}",
            "description": "Autoloaded dataset",
            "source": "generated_random",
            "point_count": 5000 * i,
            "is_public": False,
            "created_by": "admin@local.dev" if i % 2 == 0 else "user@local.dev",
            "comment": "seed",
            "created_date": created,
            "updated_date": created,
        }
        for i in range(1, 9)
    ]
    insert = await db.datasets.insert_many(datasets)
    dataset_ids = [str(x) for x in insert.inserted_ids]
    statuses = ["completed", "processing", "failed", "queued"]
    benchmark_docs: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    algorithms = ["kdtree", "octree", "balltree", "rtree", "svo", "phtree", "morton", "hilbert"]
    for idx, dataset_id in enumerate(dataset_ids):
        status = statuses[idx % len(statuses)]
        algo = algorithms[idx % len(algorithms)]
        doc = {
            "dataset_id": dataset_id,
            "dataset_name": f"Seed dataset {idx + 1}",
            "algorithm": algo,
            "build_time_ms": 40 + idx * 7,
            "memory_mb": 90 + idx * 3,
            "accuracy_pct": 96.0 - (idx % 5),
            "point_count": 5000 * (idx + 1),
            "status": status,
            "comment": "seed benchmark",
            "created_by": "admin@local.dev",
            "created_date": created,
            "updated_date": created,
        }
        benchmark_docs.append(doc)
    br_ins = await db.benchmark_results.insert_many(benchmark_docs)
    for br_id, br in zip(br_ins.inserted_ids, benchmark_docs):
        events.append(
            {
                "result_id": str(br_id),
                "from_status": "",
                "to_status": br["status"],
                "created_date": created,
            }
        )
    if events:
        await db.benchmark_status_events.insert_many(events)
    logger.info("Database seeded: admin=%s user=%s", str(admin_id), str(user_id))


async def ensure_seed_credentials() -> None:
    now = now_iso()
    seed_users = [
        {
            "email": "admin@local.dev",
            "password_hash": hash_password("admin123"),
            "role": "admin",
            "full_name": "Admin User",
            "display_name": "Admin",
            "comment": "Seed admin",
        },
        {
            "email": "user@local.dev",
            "password_hash": hash_password("user123"),
            "role": "user",
            "full_name": "Default User",
            "display_name": "User",
            "comment": "Seed user",
        },
    ]
    for item in seed_users:
        existing = await db.users.find_one({"email": item["email"]})
        if existing:
            await db.users.update_one(
                {"_id": existing["_id"]},
                {"$set": {**item, "updated_date": now}},
            )
        else:
            await db.users.insert_one({**item, "created_date": now, "updated_date": now})


async def repair_benchmark_dataset_links() -> None:
    datasets = await db.datasets.find({}, {"name": 1}).to_list(length=100000)
    if not datasets:
        return
    dataset_ids = {str(d["_id"]) for d in datasets}
    by_name: dict[str, list[str]] = {}
    for d in datasets:
        name = (d.get("name") or "").strip()
        if not name:
            continue
        by_name.setdefault(name, []).append(str(d["_id"]))

    broken = await db.benchmark_results.find({}).to_list(length=100000)
    for br in broken:
        ds_id = str(br.get("dataset_id") or "")
        if ds_id in dataset_ids:
            continue
        ds_name = (br.get("dataset_name") or "").strip()
        candidates = by_name.get(ds_name, [])
        # Heal only unambiguous links
        if len(candidates) == 1:
            await db.benchmark_results.update_one(
                {"_id": br["_id"]},
                {"$set": {"dataset_id": candidates[0], "updated_date": now_iso()}},
            )


@app.on_event("startup")
async def startup_db_client() -> None:
    global client, db
    logger.info("Connecting to MongoDB at %s...", MONGO_URL)
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await client.admin.command("ping")
    await db.sessions.create_index("token", unique=True)
    await db.users.create_index("email", unique=True)
    await seed_if_empty()
    await ensure_seed_credentials()
    await repair_benchmark_dataset_links()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/files", StaticFiles(directory=str(UPLOAD_DIR)), name="files")


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    if client:
        client.close()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/login")
async def auth_login(payload: AuthLoginRequest) -> dict[str, Any]:
    user = await db.users.find_one({"email": payload.email})
    if not user or user.get("password_hash") != hash_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = secrets.token_hex(24)
    await db.sessions.insert_one(
        {"token": token, "user_id": str(user["_id"]), "created_date": now_iso()}
    )
    return {"access_token": token, "user": oid_str(user)}


@app.post("/auth/register")
async def auth_register(payload: AuthRegisterRequest) -> dict[str, Any]:
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")

    created = now_iso()
    full_name = (payload.full_name or email.split("@")[0]).strip()
    user_doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "role": "user",
        "full_name": full_name,
        "display_name": full_name,
        "comment": "",
        "created_date": created,
        "updated_date": created,
    }
    inserted = await db.users.insert_one(user_doc)
    created_user = await db.users.find_one({"_id": inserted.inserted_id})
    token = secrets.token_hex(24)
    await db.sessions.insert_one(
        {"token": token, "user_id": str(inserted.inserted_id), "created_date": created}
    )
    return {"access_token": token, "user": oid_str(created_user)}


@app.post("/auth/logout")
async def auth_logout(user: dict[str, Any] = Depends(require_user), authorization: Optional[str] = Header(default=None)) -> dict[str, bool]:
    token = authorization.split(" ", 1)[1]
    await db.sessions.delete_many({"token": token})
    return {"ok": True}


@app.get("/auth/me")
async def auth_me(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return user


@app.patch("/auth/me")
async def auth_update_me(payload: AuthUpdateMeRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    update = make_filter(payload.model_dump())
    if update:
        update["updated_date"] = now_iso()
        await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": update})
    fresh = await db.users.find_one({"_id": ObjectId(user["id"])})
    return oid_str(fresh)


@app.post("/benchmarks/run")
async def benchmarks_run(payload: BenchmarkRunRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    dataset = await db.datasets.find_one({"_id": ObjectId(payload.dataset_id)})
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    created = now_iso()
    record = {
        "dataset_id": payload.dataset_id,
        "dataset_name": dataset.get("name", ""),
        "algorithm": payload.algorithm.lower(),
        "status": "processing",
        "point_count": int(dataset.get("point_count") or 0),
        "created_by": user.get("email"),
        "created_date": created,
        "updated_date": created,
    }
    inserted = await db.benchmark_results.insert_one(record)
    result_id = str(inserted.inserted_id)
    await db.benchmark_status_events.insert_one(
        {
            "result_id": result_id,
            "from_status": "",
            "to_status": "processing",
            "created_date": created,
        }
    )

    try:
        points = generate_dataset_points(dataset)
        build_ms, memory_mb, accuracy_pct = run_algorithm(points, payload.algorithm)
        updated = {
            "status": "completed",
            "build_time_ms": build_ms,
            "memory_mb": memory_mb,
            "accuracy_pct": accuracy_pct,
            "updated_date": now_iso(),
        }
        await db.benchmark_results.update_one({"_id": inserted.inserted_id}, {"$set": updated})
        await db.benchmark_status_events.insert_one(
            {
                "result_id": result_id,
                "from_status": "processing",
                "to_status": "completed",
                "created_date": now_iso(),
            }
        )
    except Exception as exc:
        await db.benchmark_results.update_one(
            {"_id": inserted.inserted_id},
            {"$set": {"status": "failed", "comment": str(exc), "updated_date": now_iso()}},
        )
        await db.benchmark_status_events.insert_one(
            {
                "result_id": result_id,
                "from_status": "processing",
                "to_status": "failed",
                "created_date": now_iso(),
            }
        )

    final = await db.benchmark_results.find_one({"_id": inserted.inserted_id})
    return oid_str(final)


async def list_common(collection: str, filter_raw: Optional[str], order_by: Optional[str], limit: int) -> list[dict[str, Any]]:
    filt: dict[str, Any] = {}
    if filter_raw:
        import json

        filt = make_filter(json.loads(filter_raw))
    key, order = parse_order_by(order_by)
    docs = await db[collection].find(filt).sort(key, order).limit(limit).to_list(length=limit)
    return [oid_str(x) for x in docs]


@app.get("/entities/{entity}/list")
async def entity_list(entity: str, orderBy: Optional[str] = Query(default="-created_date"), limit: int = Query(default=100, ge=1, le=5000), user: dict[str, Any] = Depends(require_user)) -> list[dict[str, Any]]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    return await list_common(coll, None, orderBy, limit)


@app.get("/entities/{entity}/filter")
async def entity_filter(entity: str, filter: Optional[str] = Query(default=None), orderBy: Optional[str] = Query(default="-created_date"), limit: int = Query(default=100, ge=1, le=5000), user: dict[str, Any] = Depends(require_user)) -> list[dict[str, Any]]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    return await list_common(coll, filter, orderBy, limit)


@app.get("/entities/{entity}/{record_id}")
async def entity_get(entity: str, record_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    doc = await db[coll].find_one({"_id": ObjectId(record_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return oid_str(doc)


@app.post("/entities/{entity}")
async def entity_create(entity: str, payload: EntityMutation, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    doc = payload.data
    now = now_iso()
    doc.setdefault("created_date", now)
    doc["updated_date"] = now
    doc.setdefault("created_by", user.get("email"))
    if entity == "User" and "password_hash" not in doc:
        doc["password_hash"] = hash_password("changeme123")
    inserted = await db[coll].insert_one(doc)
    if entity == "BenchmarkResult":
        await db.benchmark_status_events.insert_one(
            {
                "result_id": str(inserted.inserted_id),
                "from_status": "",
                "to_status": doc.get("status", "queued"),
                "created_date": now,
            }
        )
    return oid_str(await db[coll].find_one({"_id": inserted.inserted_id}))


@app.patch("/entities/{entity}/{record_id}")
async def entity_update(entity: str, record_id: str, payload: EntityMutation, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    current = await db[coll].find_one({"_id": ObjectId(record_id)})
    if not current:
        raise HTTPException(status_code=404, detail="Not found")
    update = payload.data
    update["updated_date"] = now_iso()
    await db[coll].update_one({"_id": ObjectId(record_id)}, {"$set": update})
    if entity == "BenchmarkResult" and "status" in update and update["status"] != current.get("status"):
        await db.benchmark_status_events.insert_one(
            {
                "result_id": record_id,
                "from_status": current.get("status", ""),
                "to_status": update["status"],
                "created_date": now_iso(),
            }
        )
    return oid_str(await db[coll].find_one({"_id": ObjectId(record_id)}))


@app.delete("/entities/{entity}/{record_id}")
async def entity_delete(entity: str, record_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, bool]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    await db[coll].delete_one({"_id": ObjectId(record_id)})
    return {"ok": True}


@app.post("/entities/{entity}/bulk")
async def entity_bulk_create(entity: str, payload: BulkMutation, user: dict[str, Any] = Depends(require_user)) -> list[dict[str, Any]]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    now = now_iso()
    prepared = []
    for item in payload.items:
        row = dict(item)
        row.setdefault("created_date", now)
        row["updated_date"] = now
        row.setdefault("created_by", user.get("email"))
        prepared.append(row)
    if not prepared:
        return []
    result = await db[coll].insert_many(prepared)
    docs = await db[coll].find({"_id": {"$in": result.inserted_ids}}).to_list(length=len(result.inserted_ids))
    return [oid_str(x) for x in docs]


@app.post("/users/invite")
async def users_invite(payload: InviteRequest, admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    exists = await db.users.find_one({"email": payload.email})
    if exists:
        raise HTTPException(status_code=409, detail="User exists")
    now = now_iso()
    user_doc = {
        "email": payload.email,
        "password_hash": hash_password("changeme123"),
        "role": payload.role if payload.role in {"admin", "user"} else "user",
        "full_name": payload.email.split("@")[0],
        "display_name": payload.email.split("@")[0],
        "comment": "",
        "created_date": now,
        "updated_date": now,
    }
    inserted = await db.users.insert_one(user_doc)
    return oid_str(await db.users.find_one({"_id": inserted.inserted_id}))


@app.post("/files/upload")
async def files_upload(file: UploadFile = File(...), user: dict[str, Any] = Depends(require_user)) -> dict[str, str]:
    ext = Path(file.filename).suffix
    safe_name = f"{secrets.token_hex(8)}{ext}"
    target = UPLOAD_DIR / safe_name
    content = await file.read()
    target.write_bytes(content)
    return {"file_url": f"/files/{safe_name}"}


@app.post("/backup/export")
async def backup_export(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    datasets = [oid_str(x) for x in await db.datasets.find({}).to_list(length=100000)]
    benchmarks = [oid_str(x) for x in await db.benchmark_results.find({}).to_list(length=100000)]
    users = [oid_str(x) for x in await db.users.find({}, {"password_hash": 0}).to_list(length=100000)]
    events = [oid_str(x) for x in await db.benchmark_status_events.find({}).to_list(length=100000)]
    return {
        "exported_at": now_iso(),
        "version": "1.0",
        "entities": {
            "datasets": datasets,
            "benchmarks": benchmarks,
            "users": users,
            "benchmark_status_events": events,
        },
    }


@app.post("/backup/import-replace")
async def backup_import_replace(payload: ReplaceImportRequest, admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    entities = payload.entities
    datasets = entities.get("datasets", [])
    benchmarks = entities.get("benchmarks", [])
    users = entities.get("users", [])
    events = entities.get("benchmark_status_events", [])

    await db.datasets.delete_many({})
    await db.benchmark_results.delete_many({})
    await db.benchmark_status_events.delete_many({})
    await db.sessions.delete_many({})
    await db.users.delete_many({})

    def strip_ids(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        cleaned = []
        for row in rows:
            copy = dict(row)
            copy.pop("id", None)
            cleaned.append(copy)
        return cleaned

    dataset_id_map: dict[str, str] = {}
    result_id_map: dict[str, str] = {}

    if users:
        to_insert = []
        for u in strip_ids(users):
            if "password_hash" not in u:
                u["password_hash"] = hash_password("changeme123")
            to_insert.append(u)
        await db.users.insert_many(to_insert)
    if datasets:
        dataset_rows = []
        old_dataset_ids = []
        for row in datasets:
            old_dataset_ids.append(str(row.get("id") or ""))
            copy = dict(row)
            copy.pop("id", None)
            dataset_rows.append(copy)
        inserted = await db.datasets.insert_many(dataset_rows)
        for old_id, new_id in zip(old_dataset_ids, inserted.inserted_ids):
            if old_id:
                dataset_id_map[old_id] = str(new_id)
    if benchmarks:
        benchmark_rows = []
        old_result_ids = []
        for row in benchmarks:
            old_result_ids.append(str(row.get("id") or ""))
            copy = dict(row)
            copy.pop("id", None)
            old_ds_id = str(copy.get("dataset_id") or "")
            if old_ds_id in dataset_id_map:
                copy["dataset_id"] = dataset_id_map[old_ds_id]
            benchmark_rows.append(copy)
        inserted = await db.benchmark_results.insert_many(benchmark_rows)
        for old_id, new_id in zip(old_result_ids, inserted.inserted_ids):
            if old_id:
                result_id_map[old_id] = str(new_id)
    if events:
        event_rows = []
        for row in events:
            copy = dict(row)
            copy.pop("id", None)
            old_result_id = str(copy.get("result_id") or "")
            if old_result_id in result_id_map:
                copy["result_id"] = result_id_map[old_result_id]
            event_rows.append(copy)
        await db.benchmark_status_events.insert_many(event_rows)

    if await db.users.count_documents({}) == 0:
        await seed_if_empty()

    return {"ok": True}
