# Backend API (этап 0.5)

## Инструкция по запуску локально

1. Создать виртуальное окружение и установить зависимости
```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Указать URL MongoDB в `MONGO_URL` (по умолчанию `mongodb://localhost:27017`).

3. Запустить сервер
```
uvicorn main:app --host 0.0.0.0 --port 8000
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
- `POST /files/upload`
- `POST /backup/export`
- `POST /backup/import-replace`

Где `Entity` из: `Dataset`, `BenchmarkResult`, `BenchmarkResultStatusEvent`, `User`.

## Seed учеток по умолчанию

- `admin@local.dev / admin123`
- `user@local.dev / user123`

Создаются автоматически при пустой БД.

