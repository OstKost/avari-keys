# TASK-059 — Сохранение роута при перезагрузке и обновление маскота

## Статус: ✅ Done

## Цель
1. Обеспечить сохранение текущей активной вкладки и роута при перезагрузке страницы (F5 / Cmd+R) и прямых переходах по URL.
2. Поддержать историю браузера («Назад» и «Вперёд») через HTML5 History API.
3. Заменить арт маскота-помощника Ари на более милую чиби-версию с прозрачным альфа-каналом.

## Реализация
- `apps/frontend/src/utils/route.ts`: модуль резолвинга маршрутов (`resolveTabFromUrl`, `tabToPath`, `updateDocumentTitle`), поддержка канонических путей (`/keys`, `/dashboard`, `/news`, `/billing`, `/profile`, `/admin/nodes`, `/admin/users`, `/admin/keys`, `/admin/logs`, `/admin/settings`), псевдонимов и хэшей (`#...`), резервное восстановление через `localStorage`, защита доступа к админским разделам.
- `apps/frontend/src/App.tsx`: ленивая инициализация `activeTab`, централизованный `navigateToTab()`, подписка на `popstate`, динамическое обновление `document.title`.
- `apps/frontend/public/assets/mascot.png` & `mascot_avatar.png`: сегментация и удаление запечённого фона, подготовка полноростовой фигурки и центрированного аватара.
- `apps/backend/internal/storage/sqlite.go`: автозаполнение начальных объявлений при пустой таблице `announcements`.

## Верификация
- Тесты резолвера роутов: `node scratch/test_route.mjs` — PASS.
- Сборка фронтенда: `npm run build` — PASS.
- Тесты бэкенда: `go test -v ./...` — PASS.
