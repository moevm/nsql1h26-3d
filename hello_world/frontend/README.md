# Frontend (интеграция с local backend API)

## Запуск

```bash
npm install
npm run dev
```

Приложение: `http://localhost:5173`.
Ожидается backend API на `http://localhost:8000` (через Vite proxy).

## Авторизация

Фронт работает с bearer-токеном (`localStorage` ключ `nsql_api_token`) и API:
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`

По умолчанию используется seed admin (`admin@local.dev / admin123`), если токен отсутствует.

## Поддерживаемые сущности

- `Dataset`
- `BenchmarkResult`
- `BenchmarkResultStatusEvent`
- `User`

Импорт/экспорт выполняется через backend:
- `POST /backup/export`
- `POST /backup/import-replace`
