# nosql_template

## Прототип 0.5: Хранение и представление

Актуальное приложение (backend + frontend) в каталоге [`service/`](service/). Корневой `docker compose` собирает образы из `service/backend` и `service/frontend`.

Каталог [`hello_world/`](hello_world/) — снимок первого этапа (hello world + Docker), зафиксированный в коммите `263a6a0`; для сдачи/истории. Для разработки полного прототипа правки вносятся в `service/`.

### Быстрый запуск

```bash
docker compose build --no-cache
docker compose up
```

Сервисы:
- `frontend` -> `127.0.0.1:5173`
- `backend` -> `127.0.0.1:8000`
- `db` (MongoDB, отдельный контейнер, без внешнего порта, с volume `mongo_data`)

### Тестовые пользователи (seed)

- admin: `admin@local.dev` / `admin123`
- user: `user@local.dev` / `user123`

Данные и пользователи создаются автоматически при пустой БД на старте backend.

### Что реализовано

- UI для просмотра/добавления/редактирования основных сущностей (`Dataset`, `BenchmarkResult`, `User`)
- Многокритериальные фильтры и таблицы по сущностям
- История статусов benchmark (`BenchmarkResultStatusEvent`)
- Полный экспорт данных
- Полный импорт данных в режиме **replace** (очистка и загрузка)
- Авторизация через login/password (backend API), роли `admin`/`user`


## Предварительная проверка заданий

<a href=" ./../../../actions/workflows/1_helloworld.yml" >![1. Согласована и сформулирована тема курсовой]( ./../../actions/workflows/1_helloworld.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/2_usecase.yml" >![2. Usecase]( ./../../actions/workflows/2_usecase.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/3_data_model.yml" >![3. Модель данных]( ./../../actions/workflows/3_data_model.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/4_prototype_store_and_view.yml" >![4. Прототип хранение и представление]( ./../../actions/workflows/4_prototype_store_and_view.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/5_prototype_analysis.yml" >![5. Прототип анализ]( ./../../actions/workflows/5_prototype_analysis.yml/badge.svg)</a> 

<a href=" ./../../../actions/workflows/6_report.yml" >![6. Пояснительная записка]( ./../../actions/workflows/6_report.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/7_app_is_ready.yml" >![7. App is ready]( ./../../actions/workflows/7_app_is_ready.yml/badge.svg)</a>
