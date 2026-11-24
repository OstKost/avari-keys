# TASK-079: Frontend Code-Splitting & TMA Bundle Optimization

## 1. Цели и скоуп
- **Проблема**: Текущий бандл фронтенда представляет собой единый монолит `dist/assets/index-*.js` размером ~745 КБ (181 КБ gzip). При открытии TMA (Telegram Mini App на мобильном интернете) или пользовательского дашборда клиенты вынуждены загружать админские таблицы, тяжелые модалки и библиотеки генерации QR-кодов. Vite выдает предупреждение `(!) Some chunks are larger than 500 kB`.
- **Цель**:
  1. Настроить Rollup `manualChunks` в `vite.config.ts`: вынести вендорные зависимости `vendor-react` (`react`, `react-dom`), `vendor-icons` (`lucide-react`) и `vendor-qr` (`qrcode.react`).
  2. Перевести тяжелые компоненты на `React.lazy()` + `<Suspense>` в `App.tsx`:
     - `TelegramMiniApp` (загружается только на роуте `/tma`)
     - `ServerDetailPage` (загружается только при переходе к диагностике узла)
     - `AdminUsers`, `AdminNodes`, `AdminAllKeys`, `AdminAuditLogs`, `AdminSettings`
     - `NewsPage`, `BillingPage`, `UserProfile`
  3. Сохранить мгновенную интерактивность основного пути пользователя (Client Keys View) с легким fallback-лоадером в стилистике Cyber-Fantasy.
  4. Проверить сборку `npm run build`: размер основного чанка должен уменьшиться с 745 КБ до < 150-200 КБ, никаких предупреждений Vite об объеме бандла.
  5. Проверить `dev:mock` и корректность навигации SPA по всем табам.

## 2. Затронутые модули и файлы
- `apps/frontend/vite.config.ts`
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/components/Loader.tsx` (или встроенный Cyber Suspense fallback)
- `_docs/TASKS.md`

## 3. Чек-лист верификации
- [x] Отсутствие предупреждений Vite `(!) Some chunks are larger than 500 kB`.
- [x] Размер основного входного чанка < 200 КБ.
- [x] Корректная ленивая подгрузка админ-панели и TMA при переходе по роутам.
- [x] Корректная работа демо-режима `npm run dev:mock`.
- [x] Успешный `npm run build`.
