import sys
import unittest
from pathlib import Path

import numpy as np
from bson import ObjectId
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main


class FakeCollection:
    def __init__(self, documents):
        self.documents = documents

    async def find_one(self, query, sort=None):
        for document in self.documents:
            if self._matches(document, query):
                return dict(document)
        return None

    def _matches(self, document, query):
        for key, value in query.items():
            document_value = document.get(key)
            if key == "_id":
                if document_value != value:
                    return False
            elif document_value != value:
                return False
        return True


class FakeDb:
    def __init__(self, datasets, benchmark_results):
        self.datasets = FakeCollection(datasets)
        self.benchmark_results = FakeCollection(benchmark_results)


class SpatialRangeQueryTests(unittest.TestCase):
    def setUp(self):
        self.points = np.array(
            [
                [-0.75, 0.0, 0.0],
                [0.0, 0.0, 0.0],
                [0.25, 0.25, 0.25],
                [0.75, 0.75, 0.75],
            ],
            dtype=np.float32,
        )
        self.bounds = {
            "xMin": -0.5,
            "xMax": 0.5,
            "yMin": -0.5,
            "yMax": 0.5,
            "zMin": -0.5,
            "zMax": 0.5,
        }

    def test_brute_force_range_query_counts_points_inside_bounds(self):
        result = main.brute_force_range_query(self.points, self.bounds)

        self.assertEqual(result["count"], 2)
        self.assertEqual(result["point_count"], 4)
        self.assertGreaterEqual(result["brute_time_ms"], 0)

    def test_indexed_range_query_matches_brute_force_for_supported_algorithms(self):
        brute_count = main.brute_force_range_query(self.points, self.bounds)["count"]

        for algorithm in sorted(main.SPATIAL_RANGE_ALGORITHMS):
            with self.subTest(algorithm=algorithm):
                result = main.indexed_vs_brute_range_query(
                    self.points, self.bounds, algorithm
                )

                self.assertEqual(result["indexed_count"], brute_count)
                self.assertEqual(result["brute_count"], brute_count)
                self.assertEqual(result["count"], brute_count)
                self.assertGreaterEqual(result["index_time_ms"], 0)

    def test_invalid_bounds_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "x_min must be <= x_max"):
            main.normalize_range_bounds(
                {
                    "xMin": 1,
                    "xMax": -1,
                    "yMin": -0.5,
                    "yMax": 0.5,
                    "zMin": -0.5,
                    "zMax": 0.5,
                }
            )

    def test_spatial_algorithm_aliases_are_normalized(self):
        self.assertEqual(main.normalize_spatial_algorithm("KD-Tree"), "kdtree")
        self.assertEqual(main.normalize_spatial_algorithm("Morton Code"), "morton")
        self.assertEqual(main.normalize_spatial_algorithm("Hilbert Curve"), "hilbert")


class SpatialRangeEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_db = main.db
        self.dataset_id = ObjectId()
        self.index_id = ObjectId()
        self.dataset = {
            "_id": self.dataset_id,
            "name": "Endpoint dataset",
            "source": "generated_random",
            "point_count": 1000,
        }
        self.completed_index = {
            "_id": self.index_id,
            "dataset_id": str(self.dataset_id),
            "algorithm": "kdtree",
            "status": "completed",
            "created_date": "2026-05-19T00:00:00+00:00",
            "build_time_ms": 1.2,
        }
        main.db = FakeDb([self.dataset], [self.completed_index])

    async def asyncTearDown(self):
        main.db = self.original_db

    async def test_spatial_range_query_endpoint_returns_verified_counts(self):
        payload = main.SpatialRangeQueryRequest(
            dataset_id=str(self.dataset_id),
            algorithm="KD-Tree",
            bounds={
                "xMin": -0.5,
                "xMax": 0.5,
                "yMin": -0.5,
                "yMax": 0.5,
                "zMin": -0.5,
                "zMax": 0.5,
            },
        )

        response = await main.spatial_range_query(payload, {"email": "admin@local.dev"})

        self.assertEqual(response["algorithm"], "kdtree")
        self.assertEqual(response["indexed_count"], response["brute_count"])
        self.assertEqual(response["count"], response["brute_count"])
        self.assertEqual(response["index"]["id"], str(self.index_id))
        self.assertEqual(response["index"]["status"], "completed")

    async def test_spatial_range_query_endpoint_requires_completed_index(self):
        payload = main.SpatialRangeQueryRequest(
            dataset_id=str(self.dataset_id),
            algorithm="rtree",
            bounds={
                "xMin": -0.5,
                "xMax": 0.5,
                "yMin": -0.5,
                "yMax": 0.5,
                "zMin": -0.5,
                "zMax": 0.5,
            },
        )

        with self.assertRaises(HTTPException) as raised:
            await main.spatial_range_query(payload, {"email": "admin@local.dev"})

        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("Index is not built", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
