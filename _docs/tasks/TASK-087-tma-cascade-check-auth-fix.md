# TASK-087: Устранение ошибки авторизации при проверке каскада в Telegram Mini App (Unauthorized: authentication required)

## 1. Контекст и проблема
При открытии Telegram Mini App (TMA) под аккаунтом администратора и переходе на вкладку каскада («Каскад») нажатие кнопки «Проверить» шлюзы выхода приводило к ошибке:
> `Ошибка проверки шлюзов: Unauthorized: authentication required`

При этом на начальной загрузке список шлюзов выхода не отображался (оставался пустым), так как фоновый запрос `api.getNodeEgress(cascade.id)` завершался с такой же ошибкой 401 и подавлялся через `.catch(() => null)`.

### Причины сбоя:
1. **Состояние гонки (Race Condition) в `App.tsx`**:
   При открытии TMA (`activeTab === 'miniapp'`) корневой компонент `App.tsx` запускал свой mount `useEffect`, вызывающий `api.getMe()`. Если в `localStorage` оставался устаревший токен от веб-сессии или происходила задержка, `api.getMe()` завершался ошибкой 401 и в блоке `.catch()` вызывал `api.logout()`. Метод `api.logout()` выполнял `localStorage.removeItem('token')`, удаляя свежий токен авторизации, который `TelegramMiniApp` только что сохранил через `api.authenticateTelegramMiniApp(initData)`.
2. **Отсутствие in-memory токена в `client.ts`**:
   Хранилище токенов `getAuthHeaders()` полагалось исключительно на чтение `localStorage.getItem('token')`. В случае изоляции или сброса `localStorage` в мобильных WebView Telegram (iOS WKWebView / Android WebView) или при очистке `api.logout()`, последующие запросы отправлялись без заголовка `Authorization: Bearer <token>`, что приводило к ответу бэкенда `401 Unauthorized: authentication required`.
3. **Отсутствие авто-восстановления сессии (Transparent Re-Authentication) в TMA**:
   В TMA объект `initData` криптографически подписан ботом и всегда доступен через `window.Telegram.WebApp.initData`. При кратковременной инвалидации токена или получении 401 компонент TMA не предпринимал попытки прозрачной реавторизации перед показом ошибки пользователю.
4. **Синхронизация роли администратора в `handlers_auth.go`**:
   Если Telegram-чат администратора (`chat.IsAdmin == true`) был привязан к учетной записи пользователя, созданной через обычную регистрацию (`user.Role == "user"`), токен генерировался без прав администратора.

---

## 2. Скоуп изменений

### Фронтенд:
- **`apps/frontend/src/App.tsx`**:
  - В эффекте проверки сессии добавить ранний выход `if (activeTab === 'miniapp') return;`, предотвращающий гонку и удаление токена Mini App через `api.logout()`.
- **`apps/frontend/src/api/client.ts`**:
  - Внедрить in-memory кэш токена (`inMemoryToken`) с функциями `setAuthToken` / `getAuthToken`, гарантирующими сохранность сессии даже при сбоях или очистке `localStorage`.
  - Синхронизировать `login`, `authenticateTelegramMiniApp`, `updateProfile` и `logout` для работы с единым менеджером токенов.
- **`apps/frontend/src/components/TelegramMiniApp.tsx`**:
  - Добавить метод прозрачной реавторизации `ensureAuthenticated()`.
  - В функциях `handleCheckCascadeEgress` и `handleSwitchCascadeEgress` реализовать автоматический перехват 401 ошибки с прозрачным обновлением токена через Telegram `initData` и повтором запроса.
- **`apps/frontend/src/api/mockClient.ts`**:
  - Обеспечить полный паритет mock-клиента с новым механизмом управления токенами.

### Бэкенд:
- **`apps/backend/internal/master/handlers_auth.go`**:
  - В `handleTelegramMiniAppAuth`: если чат помечен как административный (`chat.IsAdmin == true`), гарантировать наличие роли администратора (`models.RoleAdmin`) у связанного пользователя.

---

## 3. Чек-лист верификации
- [x] Все unit-тесты бэкенда (`cd apps/backend && go test ./...`) проходят успешно.
- [x] Статическая Zero-CGo кросс-компиляция (`make build-linux`) под Linux amd64/arm64 без внешних C-зависимостей.
- [x] Сборка фронтенда (`npm run build`) компилируется без ошибок TypeScript и линтера.
- [x] В `TASKS.md` зафиксирован статус задачи.
