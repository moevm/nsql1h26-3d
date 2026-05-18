import hashlib
import json
import logging
import math
import os
import re
import secrets
import time
import tracemalloc
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urlparse

import numpy as np
from bson import ObjectId
from fastapi import Depends, FastAPI, File, HTTPException, Query, Security, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
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
bearer_scheme = HTTPBearer(auto_error=False)


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


DATASET_FILTER_FIELDS = frozenset({"source", "created_by", "is_public", "name", "description", "comment"})
BENCHMARK_FILTER_FIELDS = frozenset({"dataset_id", "dataset_name", "algorithm", "status", "created_by", "comment"})
USER_FILTER_FIELDS = frozenset({"email", "role", "full_name", "display_name"})
EVENT_FILTER_FIELDS = frozenset({"result_id", "from_status", "to_status"})
DEFAULT_GENERATED_POINT_COUNT = 10000
BENCHMARK_POINT_LIMIT = 50000
SPATIAL_BOUND_ALIASES = {
    "x_min": ("x_min", "xMin", "min_x", "minX"),
    "x_max": ("x_max", "xMax", "max_x", "maxX"),
    "y_min": ("y_min", "yMin", "min_y", "minY"),
    "y_max": ("y_max", "yMax", "max_y", "maxY"),
    "z_min": ("z_min", "zMin", "min_z", "minZ"),
    "z_max": ("z_max", "zMax", "max_z", "maxZ"),
}
SPATIAL_ALGORITHM_ALIASES = {
    "kdtree": "kdtree",
    "kd": "kdtree",
    "octree": "octree",
    "balltree": "balltree",
    "rtree": "rtree",
    "bvh": "bvh",
    "svo": "svo",
    "sparsevoxeloctree": "svo",
    "phtree": "phtree",
    "morton": "morton",
    "mortoncode": "morton",
    "zorder": "morton",
    "hilbert": "hilbert",
    "hilbertcurve": "hilbert",
}
SPATIAL_RANGE_ALGORITHMS = frozenset(SPATIAL_ALGORITHM_ALIASES.values())


def _merge_and(parts: list[dict[str, Any]], base: dict[str, Any]) -> dict[str, Any]:
    if not parts:
        return base
    if not base:
        return {"$and": parts} if len(parts) > 1 else parts[0]
    return {"$and": [base, *parts]}


def entity_payload_to_mongo(entity: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Строит Mongo-фильтр из JSON; спец-ключи (contains, диапазоны) не кладутся как равенства."""
    if not payload:
        return {}
    spec = {k: v for k, v in payload.items() if v is not None and v != ""}

    if entity == "Dataset":
        q = spec.pop("q", None)
        nc = spec.pop("name_contains", None)
        dc = spec.pop("description_contains", None)
        cdf = spec.pop("created_date_from", None)
        cdt = spec.pop("created_date_to", None)
        pcmin = spec.pop("point_count_min", None)
        pcmax = spec.pop("point_count_max", None)

        and_parts: list[dict[str, Any]] = []
        if q:
            and_parts.append(
                {
                    "$or": [
                        {"name": {"$regex": re.escape(str(q)), "$options": "i"}},
                        {"description": {"$regex": re.escape(str(q)), "$options": "i"}},
                    ]
                }
            )
        if nc:
            and_parts.append({"name": {"$regex": re.escape(str(nc)), "$options": "i"}})
        if dc:
            and_parts.append({"description": {"$regex": re.escape(str(dc)), "$options": "i"}})
        dr: dict[str, Any] = {}
        if cdf:
            dr["$gte"] = str(cdf)
        if cdt:
            dr["$lte"] = str(cdt)
        if dr:
            and_parts.append({"created_date": dr})
        pr: dict[str, Any] = {}
        if pcmin is not None and str(pcmin).strip() != "":
            try:
                pr["$gte"] = int(pcmin)
            except (TypeError, ValueError):
                pass
        if pcmax is not None and str(pcmax).strip() != "":
            try:
                pr["$lte"] = int(pcmax)
            except (TypeError, ValueError):
                pass
        if pr:
            and_parts.append({"point_count": pr})

        base: dict[str, Any] = {}
        for k, v in spec.items():
            if k in DATASET_FILTER_FIELDS:
                base[k] = v
        return _merge_and(and_parts, base)

    if entity == "BenchmarkResult":
        dnc = spec.pop("dataset_name_contains", None)
        q = spec.pop("q", None)
        qq = q or dnc
        cdf = spec.pop("created_date_from", None)
        cdt = spec.pop("created_date_to", None)

        and_parts = []
        if qq:
            and_parts.append({"dataset_name": {"$regex": re.escape(str(qq)), "$options": "i"}})
        dr = {}
        if cdf:
            dr["$gte"] = str(cdf)
        if cdt:
            dr["$lte"] = str(cdt)
        if dr:
            and_parts.append({"created_date": dr})

        base = {}
        for k, v in spec.items():
            if k not in BENCHMARK_FILTER_FIELDS:
                continue
            if k in ("algorithm", "status"):
                base[k] = str(v).lower()
            else:
                base[k] = v
        return _merge_and(and_parts, base)

    if entity == "BenchmarkResultStatusEvent":
        cdf = spec.pop("created_date_from", None)
        cdt = spec.pop("created_date_to", None)
        and_parts = []
        dr = {}
        if cdf:
            dr["$gte"] = str(cdf)
        if cdt:
            dr["$lte"] = str(cdt)
        if dr:
            and_parts.append({"created_date": dr})
        base = {}
        for k, v in spec.items():
            if k in EVENT_FILTER_FIELDS:
                base[k] = v
        return _merge_and(and_parts, base)

    if entity == "User":
        base = {}
        for k, v in spec.items():
            if k in USER_FILTER_FIELDS:
                base[k] = v
        return base

    return make_filter(payload)


async def list_common(
    collection: str,
    entity: str,
    filter_raw: Optional[str],
    order_by: Optional[str],
    limit: int,
    skip: int = 0,
    count_total: bool = False,
) -> list[dict[str, Any]] | dict[str, Any]:
    filt: dict[str, Any] = {}
    if filter_raw:
        filt = entity_payload_to_mongo(entity, json.loads(filter_raw))
    key, order = parse_order_by(order_by)
    cursor = db[collection].find(filt).sort(key, order).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    items = [oid_str(x) for x in docs]
    if count_total:
        total = await db[collection].count_documents(filt)
        return {"items": items, "total": total}
    return items


def build_seed_from_dataset(dataset: dict[str, Any]) -> int:
    seed_src = f"{dataset.get('_id')}|{dataset.get('name','')}|{dataset.get('source','')}"
    digest = hashlib.sha256(seed_src.encode("utf-8")).hexdigest()
    return int(digest[:16], 16) % (2**32)


def coerce_dataset_point_count(
    dataset: dict[str, Any],
    *,
    default: int = DEFAULT_GENERATED_POINT_COUNT,
    min_points: int = 0,
    max_points: Optional[int] = None,
) -> int:
    raw = dataset.get("point_count")
    if raw is None or raw == "":
        count = default
    else:
        try:
            count = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("Dataset point_count must be an integer") from exc
    if count < 0:
        raise ValueError("Dataset point_count must be non-negative")
    count = max(min_points, count)
    if max_points is not None:
        count = min(count, max_points)
    return count


def generate_dataset_points(
    dataset: dict[str, Any],
    *,
    min_points: int = 1000,
    max_points: Optional[int] = BENCHMARK_POINT_LIMIT,
) -> np.ndarray:
    count = coerce_dataset_point_count(dataset, min_points=min_points, max_points=max_points)
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


def _split_point_line(line: str) -> list[str]:
    return [token for token in re.split(r"[\s,;]+", line.strip()) if token]


def _finite_float(value: str) -> Optional[float]:
    try:
        parsed = float(value)
    except ValueError:
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _axis_indexes(tokens: list[str]) -> Optional[tuple[int, int, int]]:
    lowered = [token.strip().lower() for token in tokens]
    try:
        return lowered.index("x"), lowered.index("y"), lowered.index("z")
    except ValueError:
        return None


def _xyz_from_tokens(
    tokens: list[str],
    indexes: Optional[tuple[int, int, int]] = None,
) -> Optional[tuple[float, float, float]]:
    if indexes is not None:
        try:
            values = [_finite_float(tokens[index]) for index in indexes]
        except IndexError:
            return None
        if any(value is None for value in values):
            return None
        return values[0], values[1], values[2]

    values: list[float] = []
    for token in tokens:
        parsed = _finite_float(token)
        if parsed is not None:
            values.append(parsed)
        if len(values) == 3:
            return values[0], values[1], values[2]
    return None


def _points_to_array(points: list[tuple[float, float, float]], source_name: str) -> np.ndarray:
    if not points:
        raise ValueError(f"{source_name} does not contain readable x/y/z points")
    return np.asarray(points, dtype=np.float32)


def _load_delimited_points(path: Path) -> np.ndarray:
    points: list[tuple[float, float, float]] = []
    indexes: Optional[tuple[int, int, int]] = None
    checked_header = False
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("//"):
                continue
            tokens = _split_point_line(stripped)
            if not tokens:
                continue
            if not checked_header:
                checked_header = True
                indexes = _axis_indexes(tokens)
                if indexes is not None:
                    continue
            xyz = _xyz_from_tokens(tokens, indexes)
            if xyz is not None:
                points.append(xyz)
    return _points_to_array(points, path.name)


def _load_ascii_ply_points(path: Path) -> np.ndarray:
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    if not lines or lines[0].strip().lower() != "ply":
        return _load_delimited_points(path)

    vertex_count: Optional[int] = None
    vertex_properties: list[str] = []
    reading_vertex_properties = False
    header_end: Optional[int] = None
    is_ascii = False

    for line_no, line in enumerate(lines):
        stripped = line.strip()
        lowered = stripped.lower()
        parts = _split_point_line(stripped)
        if lowered.startswith("format "):
            is_ascii = len(parts) >= 2 and parts[1].lower() == "ascii"
        elif len(parts) >= 3 and parts[0].lower() == "element":
            reading_vertex_properties = parts[1].lower() == "vertex"
            if reading_vertex_properties:
                try:
                    vertex_count = int(parts[2])
                except ValueError as exc:
                    raise ValueError("PLY vertex count must be an integer") from exc
        elif reading_vertex_properties and len(parts) >= 3 and parts[0].lower() == "property":
            vertex_properties.append(parts[-1].lower())
        elif lowered == "end_header":
            header_end = line_no + 1
            break

    if not is_ascii:
        raise ValueError("Only ASCII PLY point files are supported")
    if header_end is None or vertex_count is None:
        raise ValueError("PLY file is missing vertex header")
    try:
        indexes = (
            vertex_properties.index("x"),
            vertex_properties.index("y"),
            vertex_properties.index("z"),
        )
    except ValueError as exc:
        raise ValueError("PLY vertex properties must include x, y, z") from exc

    points: list[tuple[float, float, float]] = []
    for line in lines[header_end : header_end + vertex_count]:
        xyz = _xyz_from_tokens(_split_point_line(line), indexes)
        if xyz is not None:
            points.append(xyz)
    return _points_to_array(points, path.name)


def _load_ascii_pcd_points(path: Path) -> np.ndarray:
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    fields: list[str] = []
    point_count: Optional[int] = None
    data_start: Optional[int] = None

    for line_no, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = _split_point_line(stripped)
        if not parts:
            continue
        key = parts[0].upper()
        if key == "FIELDS":
            fields = [part.lower() for part in parts[1:]]
        elif key == "POINTS" and len(parts) >= 2:
            try:
                point_count = int(parts[1])
            except ValueError as exc:
                raise ValueError("PCD POINTS value must be an integer") from exc
        elif key == "DATA":
            if len(parts) < 2 or parts[1].lower() != "ascii":
                raise ValueError("Only ASCII PCD point files are supported")
            data_start = line_no + 1
            break

    if data_start is None:
        return _load_delimited_points(path)
    indexes = _axis_indexes(fields)
    if indexes is None:
        raise ValueError("PCD FIELDS must include x, y, z")

    rows = lines[data_start:]
    if point_count is not None:
        rows = rows[:point_count]
    points: list[tuple[float, float, float]] = []
    for line in rows:
        xyz = _xyz_from_tokens(_split_point_line(line), indexes)
        if xyz is not None:
            points.append(xyz)
    return _points_to_array(points, path.name)


def _uploaded_file_path(dataset: dict[str, Any]) -> Path:
    file_url = dataset.get("file_url")
    if not file_url:
        raise ValueError("Uploaded dataset is missing file_url")
    parsed_path = unquote(urlparse(str(file_url)).path)
    file_name = Path(parsed_path).name
    if not file_name:
        raise ValueError("Uploaded dataset file_url is invalid")
    path = (UPLOAD_DIR / file_name).resolve()
    upload_root = UPLOAD_DIR.resolve()
    if path.parent != upload_root:
        raise ValueError("Uploaded dataset path is outside upload directory")
    if not path.exists():
        raise ValueError(f"Uploaded dataset file not found: {file_name}")
    return path


def load_uploaded_dataset_points(dataset: dict[str, Any]) -> np.ndarray:
    path = _uploaded_file_path(dataset)
    suffix = path.suffix.lower()
    if suffix == ".ply":
        return _load_ascii_ply_points(path)
    if suffix == ".pcd":
        return _load_ascii_pcd_points(path)
    if suffix == ".las":
        raise ValueError("LAS point files are not supported without a LAS parser dependency")
    return _load_delimited_points(path)


def load_dataset_points(dataset: dict[str, Any]) -> np.ndarray:
    source = (dataset.get("source") or "generated_random").lower()
    if source == "uploaded":
        return load_uploaded_dataset_points(dataset)
    return generate_dataset_points(dataset, min_points=0, max_points=None)


def normalize_range_bounds(bounds: dict[str, Any]) -> dict[str, float]:
    if not isinstance(bounds, dict):
        raise ValueError("Range bounds must be an object")

    normalized: dict[str, float] = {}
    missing: list[str] = []
    for key, aliases in SPATIAL_BOUND_ALIASES.items():
        raw_value = None
        found = False
        for alias in aliases:
            if alias in bounds:
                raw_value = bounds[alias]
                found = True
                break
        if not found:
            missing.append(key)
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Range bound {key} must be numeric") from exc
        if not math.isfinite(value):
            raise ValueError(f"Range bound {key} must be finite")
        normalized[key] = value

    if missing:
        raise ValueError(f"Missing range bounds: {', '.join(missing)}")

    for axis in ("x", "y", "z"):
        mn = normalized[f"{axis}_min"]
        mx = normalized[f"{axis}_max"]
        if mn > mx:
            raise ValueError(f"Range bound {axis}_min must be <= {axis}_max")

    return normalized


def ensure_point_array(points: np.ndarray) -> np.ndarray:
    arr = np.asarray(points, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError("Points must be a Nx3 array")
    return arr


def count_points_in_bounds(points: np.ndarray, bounds: dict[str, Any]) -> int:
    normalized = normalize_range_bounds(bounds)
    arr = ensure_point_array(points)
    return _count_points_in_normalized_bounds(arr, normalized)


def _count_points_in_normalized_bounds(points: np.ndarray, normalized: dict[str, float]) -> int:
    mins = np.array([normalized["x_min"], normalized["y_min"], normalized["z_min"]], dtype=np.float32)
    maxs = np.array([normalized["x_max"], normalized["y_max"], normalized["z_max"]], dtype=np.float32)
    mask = np.all((points >= mins) & (points <= maxs), axis=1)
    return int(np.count_nonzero(mask))


def brute_force_range_query(points: np.ndarray, bounds: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_range_bounds(bounds)
    arr = ensure_point_array(points)
    started = time.perf_counter()
    count = _count_points_in_normalized_bounds(arr, normalized)
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    return {
        "count": count,
        "point_count": int(len(arr)),
        "brute_time_ms": round(elapsed_ms, 3),
        "bounds": normalized,
    }


def brute_force_dataset_range_query(dataset: dict[str, Any], bounds: dict[str, Any]) -> dict[str, Any]:
    points = load_dataset_points(dataset)
    result = brute_force_range_query(points, bounds)
    dataset_id = dataset.get("_id") or dataset.get("id")
    result["dataset_id"] = str(dataset_id) if dataset_id is not None else ""
    result["dataset_name"] = dataset.get("name", "")
    return result


def normalize_spatial_algorithm(algorithm: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "", (algorithm or "").lower())
    normalized = SPATIAL_ALGORITHM_ALIASES.get(key)
    if normalized is None:
        supported = ", ".join(sorted(SPATIAL_RANGE_ALGORITHMS))
        raise ValueError(f"Unsupported spatial algorithm: {algorithm}. Supported: {supported}")
    return normalized


def _empty_range_index(points: np.ndarray, algorithm: str, index_kind: str) -> dict[str, Any]:
    return {
        "algorithm": algorithm,
        "kind": index_kind,
        "points": points,
        "buckets": [],
        "mins": np.empty((0, 3), dtype=np.float32),
        "maxs": np.empty((0, 3), dtype=np.float32),
    }


def _build_bucket_range_index(
    points: np.ndarray,
    algorithm: str,
    index_kind: str,
    buckets: list[np.ndarray],
) -> dict[str, Any]:
    if len(points) == 0 or not buckets:
        return _empty_range_index(points, algorithm, index_kind)

    mins = []
    maxs = []
    clean_buckets = []
    for bucket in buckets:
        if len(bucket) == 0:
            continue
        idxs = np.asarray(bucket, dtype=np.int64)
        pts = points[idxs]
        mins.append(np.min(pts, axis=0))
        maxs.append(np.max(pts, axis=0))
        clean_buckets.append(idxs)

    if not clean_buckets:
        return _empty_range_index(points, algorithm, index_kind)

    return {
        "algorithm": algorithm,
        "kind": index_kind,
        "points": points,
        "buckets": clean_buckets,
        "mins": np.asarray(mins, dtype=np.float32),
        "maxs": np.asarray(maxs, dtype=np.float32),
    }


def _build_ordered_bucket_index(
    points: np.ndarray,
    algorithm: str,
    index_kind: str,
    order: np.ndarray,
    group_size: int,
) -> dict[str, Any]:
    buckets = [order[i : i + group_size] for i in range(0, len(order), group_size)]
    return _build_bucket_range_index(points, algorithm, index_kind, buckets)


def _build_voxel_bucket_index(
    points: np.ndarray,
    algorithm: str,
    bins: int,
    *,
    use_morton: bool = False,
    use_hilbert: bool = False,
) -> dict[str, Any]:
    if len(points) == 0:
        return _empty_range_index(points, algorithm, "voxel")

    data_min = np.min(points, axis=0)
    data_max = np.max(points, axis=0)
    span = np.maximum(data_max - data_min, np.float32(1e-6))
    scaled = np.floor(((points - data_min) / span) * (bins - 1)).clip(0, bins - 1).astype(np.int32)

    bucket_map: dict[Any, list[int]] = {}
    if use_morton:
        bits = int(math.ceil(math.log2(bins)))
        codes = _morton_codes_from_quantized(scaled.astype(np.uint32), bits)
        for idx, code in enumerate(codes.tolist()):
            bucket_map.setdefault(int(code), []).append(idx)
    elif use_hilbert:
        bits = int(math.ceil(math.log2(bins)))
        hc = HilbertCurve(bits, 3)
        for idx, coords in enumerate(scaled.tolist()):
            code = hc.distance_from_point([int(coords[0]), int(coords[1]), int(coords[2])])
            bucket_map.setdefault(int(code), []).append(idx)
    else:
        for idx, coords in enumerate(scaled.tolist()):
            bucket_map.setdefault((int(coords[0]), int(coords[1]), int(coords[2])), []).append(idx)

    buckets = [np.asarray(idxs, dtype=np.int64) for idxs in bucket_map.values()]
    return _build_bucket_range_index(points, algorithm, "voxel", buckets)


def _morton_codes_from_quantized(q: np.ndarray, bits: int) -> np.ndarray:
    mask = np.uint32((1 << min(bits, 10)) - 1)
    coords = q.astype(np.uint32) & mask

    def part1by2(v: np.ndarray) -> np.ndarray:
        x = v & np.uint32(0x3FF)
        x = (x | (x << 16)) & np.uint32(0x30000FF)
        x = (x | (x << 8)) & np.uint32(0x300F00F)
        x = (x | (x << 4)) & np.uint32(0x30C30C3)
        x = (x | (x << 2)) & np.uint32(0x9249249)
        return x

    return part1by2(coords[:, 0]) | (part1by2(coords[:, 1]) << 1) | (part1by2(coords[:, 2]) << 2)


def build_spatial_range_index(points: np.ndarray, algorithm: str) -> dict[str, Any]:
    algo = normalize_spatial_algorithm(algorithm)
    arr = ensure_point_array(points)
    if len(arr) == 0:
        return _empty_range_index(arr, algo, "empty")

    if algo == "kdtree":
        order = np.lexsort((arr[:, 2], arr[:, 1], arr[:, 0]))
        return _build_ordered_bucket_index(arr, algo, "axis-sorted", order, 32)
    if algo == "balltree":
        center = np.mean(arr, axis=0)
        order = np.argsort(np.sum((arr - center) ** 2, axis=1))
        return _build_ordered_bucket_index(arr, algo, "radial-sorted", order, 64)
    if algo == "rtree":
        order = np.argsort(arr[:, 0] + arr[:, 1] * 0.5 + arr[:, 2] * 0.25)
        return _build_ordered_bucket_index(arr, algo, "bbox-groups", order, 64)
    if algo == "bvh":
        order = np.argsort(arr[:, 0] + arr[:, 1] * 0.31 + arr[:, 2] * 0.17)
        return _build_ordered_bucket_index(arr, algo, "bvh-groups", order, 64)
    if algo == "octree":
        return _build_voxel_bucket_index(arr, algo, 32)
    if algo == "svo":
        return _build_voxel_bucket_index(arr, algo, 64)
    if algo == "phtree":
        return _build_voxel_bucket_index(arr, algo, 128)
    if algo == "morton":
        return _build_voxel_bucket_index(arr, algo, 64, use_morton=True)
    if algo == "hilbert":
        return _build_voxel_bucket_index(arr, algo, 32, use_hilbert=True)

    raise ValueError(f"Unsupported spatial algorithm: {algorithm}")


def query_spatial_range_index(index: dict[str, Any], bounds: dict[str, Any]) -> dict[str, int]:
    normalized = normalize_range_bounds(bounds)
    points = ensure_point_array(index["points"])
    if len(points) == 0:
        return {"count": 0, "candidate_count": 0, "bucket_count": 0, "visited_bucket_count": 0}

    mins = np.array([normalized["x_min"], normalized["y_min"], normalized["z_min"]], dtype=np.float32)
    maxs = np.array([normalized["x_max"], normalized["y_max"], normalized["z_max"]], dtype=np.float32)
    bucket_mins = index["mins"]
    bucket_maxs = index["maxs"]
    intersects = np.all((bucket_maxs >= mins) & (bucket_mins <= maxs), axis=1)
    bucket_ids = np.flatnonzero(intersects)
    if len(bucket_ids) == 0:
        return {
            "count": 0,
            "candidate_count": 0,
            "bucket_count": len(index["buckets"]),
            "visited_bucket_count": 0,
        }

    candidate_idxs = np.concatenate([index["buckets"][int(i)] for i in bucket_ids])
    candidates = points[candidate_idxs]
    mask = np.all((candidates >= mins) & (candidates <= maxs), axis=1)
    return {
        "count": int(np.count_nonzero(mask)),
        "candidate_count": int(len(candidate_idxs)),
        "bucket_count": len(index["buckets"]),
        "visited_bucket_count": int(len(bucket_ids)),
    }


def indexed_range_query(points: np.ndarray, bounds: dict[str, Any], algorithm: str) -> dict[str, Any]:
    normalized = normalize_range_bounds(bounds)
    arr = ensure_point_array(points)
    algo = normalize_spatial_algorithm(algorithm)

    build_started = time.perf_counter()
    index = build_spatial_range_index(arr, algo)
    build_ms = (time.perf_counter() - build_started) * 1000.0

    query_started = time.perf_counter()
    query_result = query_spatial_range_index(index, normalized)
    query_ms = (time.perf_counter() - query_started) * 1000.0

    return {
        "algorithm": algo,
        "count": query_result["count"],
        "point_count": int(len(arr)),
        "index_time_ms": round(query_ms, 3),
        "indexed_time_ms": round(query_ms, 3),
        "index_build_time_ms": round(build_ms, 3),
        "bounds": normalized,
        "candidate_count": query_result["candidate_count"],
        "bucket_count": query_result["bucket_count"],
        "visited_bucket_count": query_result["visited_bucket_count"],
        "index_kind": index["kind"],
    }


def indexed_vs_brute_range_query(points: np.ndarray, bounds: dict[str, Any], algorithm: str) -> dict[str, Any]:
    indexed = indexed_range_query(points, bounds, algorithm)
    brute = brute_force_range_query(points, indexed["bounds"])
    if indexed["count"] != brute["count"]:
        raise RuntimeError(
            f"Indexed count mismatch: indexed={indexed['count']} brute={brute['count']}"
        )

    return {
        "algorithm": indexed["algorithm"],
        "count": brute["count"],
        "indexed_count": indexed["count"],
        "brute_count": brute["count"],
        "point_count": brute["point_count"],
        "index_time_ms": indexed["index_time_ms"],
        "indexed_time_ms": indexed["indexed_time_ms"],
        "brute_time_ms": brute["brute_time_ms"],
        "index_build_time_ms": indexed["index_build_time_ms"],
        "bounds": indexed["bounds"],
        "candidate_count": indexed["candidate_count"],
        "bucket_count": indexed["bucket_count"],
        "visited_bucket_count": indexed["visited_bucket_count"],
        "index_kind": indexed["index_kind"],
        "empty_result": brute["count"] == 0,
    }


def indexed_vs_brute_dataset_range_query(
    dataset: dict[str, Any],
    bounds: dict[str, Any],
    algorithm: str,
) -> dict[str, Any]:
    points = load_dataset_points(dataset)
    result = indexed_vs_brute_range_query(points, bounds, algorithm)
    dataset_id = dataset.get("_id") or dataset.get("id")
    result["dataset_id"] = str(dataset_id) if dataset_id is not None else ""
    result["dataset_name"] = dataset.get("name", "")
    return result


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


class SpatialRangeQueryRequest(BaseModel):
    dataset_id: Optional[str] = None
    dataset: Optional[str] = None
    algorithm: str
    bounds: dict[str, Any]


def parse_object_id_or_400(value: str, label: str) -> ObjectId:
    if not value or not ObjectId.is_valid(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label} id")
    return ObjectId(value)


def bearer_token_or_401(
    credentials: Optional[HTTPAuthorizationCredentials],
) -> str:
    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
        or not credentials.credentials
    ):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return credentials.credentials


async def require_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> dict[str, Any]:
    token = bearer_token_or_401(credentials)
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
async def auth_logout(
    user: dict[str, Any] = Depends(require_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> dict[str, bool]:
    token = bearer_token_or_401(credentials)
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


@app.post("/spatial/range-query")
async def spatial_range_query(payload: SpatialRangeQueryRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    dataset_id = (payload.dataset_id or payload.dataset or "").strip()
    dataset_oid = parse_object_id_or_400(dataset_id, "dataset")
    try:
        algorithm = normalize_spatial_algorithm(payload.algorithm)
        bounds = normalize_range_bounds(payload.bounds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    dataset = await db.datasets.find_one({"_id": dataset_oid})
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    index_record = await db.benchmark_results.find_one(
        {
            "dataset_id": dataset_id,
            "algorithm": algorithm,
            "status": "completed",
        },
        sort=[("created_date", -1)],
    )
    if not index_record:
        raise HTTPException(
            status_code=409,
            detail=f"Index is not built for dataset {dataset_id} and algorithm {algorithm}",
        )

    try:
        result = indexed_vs_brute_dataset_range_query(dataset, bounds, algorithm)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    result["index"] = {
        "id": str(index_record["_id"]),
        "algorithm": index_record.get("algorithm", algorithm),
        "status": index_record.get("status", ""),
        "created_date": index_record.get("created_date"),
        "build_time_ms": index_record.get("build_time_ms"),
    }
    return result


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
    res = await list_common(coll, entity, None, orderBy, limit, 0, False)
    assert isinstance(res, list)
    return res


@app.get("/entities/{entity}/filter")
async def entity_filter(
    entity: str,
    filter: Optional[str] = Query(default=None),
    orderBy: Optional[str] = Query(default="-created_date"),
    limit: int = Query(default=100, ge=1, le=5000),
    skip: int = Query(default=0, ge=0, le=100000),
    countTotal: bool = Query(default=False),
    user: dict[str, Any] = Depends(require_user),
) -> list[dict[str, Any]] | dict[str, Any]:
    mapping = {
        "Dataset": "datasets",
        "BenchmarkResult": "benchmark_results",
        "BenchmarkResultStatusEvent": "benchmark_status_events",
        "User": "users",
    }
    coll = mapping.get(entity)
    if not coll:
        raise HTTPException(status_code=404, detail="Unknown entity")
    return await list_common(coll, entity, filter, orderBy, limit, skip, countTotal)


class DatasetQueryBody(BaseModel):
    filter: dict[str, Any] = {}
    order_by: str = "-created_date"
    skip: int = 0
    limit: int = 20
    run_status_bucket: Optional[str] = None
    run_count_min: Optional[int] = None
    run_count_max: Optional[int] = None


def _run_count_expr(bucket: str) -> dict[str, Any]:
    b = (bucket or "all").lower()
    if b == "all":
        return {"$size": {"$ifNull": ["$br", []]}}
    if b == "unfinished":
        return {
            "$size": {
                "$filter": {
                    "input": {"$ifNull": ["$br", []]},
                    "as": "b",
                    "cond": {"$in": ["$$b.status", ["processing", "failed", "queued"]]},
                }
            }
        }
    return {
        "$size": {
            "$filter": {
                "input": {"$ifNull": ["$br", []]},
                "as": "b",
                "cond": {"$eq": ["$$b.status", b]},
            }
        }
    }


@app.post("/datasets/query")
async def datasets_query(payload: DatasetQueryBody, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    base = dict(payload.filter)
    if user.get("role") != "admin":
        base["created_by"] = user.get("email")
    mongo_filt = entity_payload_to_mongo("Dataset", base)

    has_run_filter = (
        payload.run_count_min is not None
        or payload.run_count_max is not None
        or (payload.run_status_bucket and str(payload.run_status_bucket).lower() not in ("", "all"))
    )

    key, order = parse_order_by(payload.order_by)
    sort_dir = order

    if not has_run_filter:
        total = await db.datasets.count_documents(mongo_filt)
        docs = (
            await db.datasets.find(mongo_filt)
            .sort(key, sort_dir)
            .skip(payload.skip)
            .limit(payload.limit)
            .to_list(length=payload.limit)
        )
        return {"items": [oid_str(x) for x in docs], "total": total}

    bucket = (payload.run_status_bucket or "all").lower()
    rc_expr = _run_count_expr(bucket)

    match_rc: dict[str, Any] = {}
    if payload.run_count_min is not None:
        match_rc["$gte"] = payload.run_count_min
    if payload.run_count_max is not None:
        match_rc["$lte"] = payload.run_count_max

    lookup_stage: dict[str, Any] = {
        "$lookup": {
            "from": "benchmark_results",
            "let": {"ds_id": {"$toString": "$_id"}},
            "pipeline": [{"$match": {"$expr": {"$eq": ["$dataset_id", "$$ds_id"]}}}],
            "as": "br",
        }
    }

    pipeline: list[dict[str, Any]] = [
        {"$match": mongo_filt},
        lookup_stage,
        {"$addFields": {"run_count": rc_expr}},
    ]
    if match_rc:
        pipeline.append({"$match": {"run_count": match_rc}})

    pipeline.append({"$project": {"br": 0, "run_count": 0}})
    pipeline.append({"$sort": {key: sort_dir}})
    facet_stage = {
        "$facet": {
            "items": [{"$skip": payload.skip}, {"$limit": payload.limit}],
            "meta": [{"$count": "total"}],
        }
    }
    pipeline.append(facet_stage)

    agg = await db.datasets.aggregate(pipeline).to_list(length=1)
    if not agg:
        return {"items": [], "total": 0}
    row = agg[0]
    items_raw = row.get("items") or []
    meta = row.get("meta") or []
    total = int(meta[0]["total"]) if meta else 0
    return {"items": [oid_str(x) for x in items_raw], "total": total}


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
