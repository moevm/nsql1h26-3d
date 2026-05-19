# Backend API (этап 0.5)

## Инструкция по запуску локально

1. Создать виртуальное окружение и установить зависимости

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

1. Указать URL MongoDB в `MONGO_URL` (по умолчанию `mongodb://localhost:27017`).

2. Запустить сервер

```
uvicorn main:app --host 0.0.0.0 --port 8000
```

1. Запустить backend-тесты

```
python -m unittest discover -s tests
```

## Основные API ручки

- `POST /auth/login`
- `GET /auth/me`
- `PATCH /auth/me`
- `POST /auth/logout`
- `GET /entities/{Entity}/list`
- `GET /entities/{Entity}/filter`
- `GET /entities/{Entity}/{id}`
- `POST /entities/{Entity}`
- `PATCH /entities/{Entity}/{id}`
- `DELETE /entities/{Entity}/{id}`
- `POST /entities/{Entity}/bulk`
- `POST /users/invite`
- `POST /benchmarks/run`
- `POST /spatial/range-query`
- `POST /files/upload`
- `GET /datasets/{dataset_id}/export`
- `POST /backup/export`
- `POST /backup/import-replace`

Где `Entity` из: `Dataset`, `BenchmarkResult`, `BenchmarkResultStatusEvent`, `User`.

## CSV датасеты

`POST /files/upload` принимает CSV-файл с точками. Другие форматы для загрузки
через эту ручку не поддерживаются.

Файл должен содержать координаты точек `x`, `y`, `z` в формате, который умеет
читать backend-загрузчик точек. При успешной загрузке backend сохраняет файл,
валидирует его и возвращает ссылку на файл и количество точек:

```json
{
  "file_url": "/files/0f4f8c8d7d43c8f4_cloud.csv",
  "point_count": 10000
}
```

После загрузки файл можно привязать к датасету через `POST /entities/Dataset`,
указав `source: "uploaded"`, `file_url`, `file_name` и `point_count`.

`GET /datasets/{dataset_id}/export` экспортирует датасет в CSV с колонками
`x`, `y`, `z`. Для обычного пользователя доступны только свои или публичные
датасеты, администратор может экспортировать любой датасет.

## Backup

`POST /backup/export` экспортирует данные проекта в JSON, но не включает
admin-пользователей и их `password_hash`.

`POST /backup/import-replace` заменяет данные проекта из backup-JSON, сохраняя
существующих admin-пользователей и их сессии. Это нужно, чтобы после
восстановления backup текущий администратор не терял авторизацию.

## Seed учеток по умолчанию

- `admin@local.dev / admin123`
- `user@local.dev / user123`

Создаются автоматически при пустой БД.

## Spatial range query

Ручка `POST /spatial/range-query` реализует сценарий 3.2: пространственный поиск в
3D-диапазоне с одновременной проверкой результата прямым перебором.

Перед вызовом нужен completed benchmark для того же датасета и алгоритма. Его можно
создать через `POST /benchmarks/run`.

Пример запроса:

```json
{
  "dataset_id": "6a0b6f045ec421a433ce8569",
  "algorithm": "kdtree",
  "bounds": {
    "xMin": -0.5,
    "xMax": 0.5,
    "yMin": -0.5,
    "yMax": 0.5,
    "zMin": -0.5,
    "zMax": 0.5
  }
}
```

В `bounds` также поддерживаются snake_case-ключи: `x_min`, `x_max`, `y_min`,
`y_max`, `z_min`, `z_max`.

Поддерживаемые алгоритмы:

- `kdtree`
- `octree`
- `balltree`
- `rtree`
- `bvh`
- `svo`
- `phtree`
- `morton`
- `hilbert`

Ответ содержит реальные замеры indexed/brute-force и сверку количества найденных
точек:

```json
{
  "algorithm": "kdtree",
  "count": 1279,
  "indexed_count": 1279,
  "brute_count": 1279,
  "point_count": 10000,
  "index_time_ms": 0.399,
  "brute_time_ms": 0.293,
  "index_build_time_ms": 5.224,
  "candidate_count": 4992,
  "bucket_count": 313,
  "visited_bucket_count": 156,
  "index_kind": "axis-sorted",
  "empty_result": false,
  "index": {
    "id": "6a0b81d1441d10543f4484e1",
    "algorithm": "kdtree",
    "status": "completed",
    "build_time_ms": 1.3
  }
}
```

Коды ошибок:

- `400` — невалидный `dataset_id`, алгоритм или границы диапазона.
- `404` — датасет не найден.
- `409` — для выбранного датасета и алгоритма нет completed benchmark/index.
- `500` — indexed count не совпал с brute-force count.
