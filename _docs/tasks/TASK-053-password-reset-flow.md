# TASK-053: Password Reset Request and Multi-Channel Admin Approval

## 📌 Описание задачи
Реализация процесса сброса пароля пользователя:
1. Кнопка/ссылка «Забыли пароль? Сбросить» на форме авторизации.
2. Переключение формы в режим запроса: ввод логина и нового пароля.
3. Отправка заявки администратору с сохранением bcrypt-хеша в SQLite.
4. Оповещение администратора в Telegram-боте с Inline-кнопками «Одобрить сброс» и «Отклонить».
5. Возможность одобрения/отклонения запроса сброса пароля в веб-интерфейсе админ-панели (список пользователей).
6. Аудит-логирование и уведомление пользователя при наличии привязанного Telegram.

## 🎯 Чек-лист реализации

### 1. Бэкенд (Go & SQLite)
- [x] Таблица `password_reset_requests` и индексы по `user_id`, `status`
- [x] Модели `PasswordResetRequest`, `ResetPasswordRequestDTO` и расширение `UserPublic`
- [x] Методы SQLite хранилища: `CreatePasswordResetRequest`, `GetPasswordResetRequestByID`, `GetPendingPasswordResetRequestByUserID`, `ApprovePasswordReset`, `ApprovePasswordResetByUserID`, `RejectPasswordReset`, `RejectPasswordResetByUserID`
- [x] Выборка `HasPendingPasswordReset` в `ListUsers` через `LEFT JOIN`
- [x] Эндпоинт `POST /api/v1/auth/reset-password`
- [x] Эндпоинты `POST /api/v1/admin/users/{id}/approve-password-reset` и `POST /api/v1/admin/users/{id}/reject-password-reset`
- [x] Оповещения в Telegram-боте: `NotifyPasswordReset`, обработка callback-кнопок `approve_pwd_reset:<id>` и `reject_pwd_reset:<id>`
- [x] Unit-тесты хранилища, обработчиков Master API и Telegram-бота

### 2. Фронтенд (React & TypeScript)
- [x] Расширение типа `User` полем `has_pending_password_reset?: boolean`
- [x] Методы API клиента: `requestPasswordReset`, `approvePasswordReset`, `rejectPasswordReset` (включая `mockClient.ts`)
- [x] `AuthModal.tsx`: ссылки переключения в режим «Забыли пароль? Сбросить», форма логин + новый пароль, отправка запроса
- [x] `MascotAssistant.tsx`: поддержка реплик Ари для режима `forgot_password`
- [x] `AdminUsers.tsx`: индикатор «Сброс пароля» в столбце статуса, действия одобрения/отклонения с `ConfirmModal`

### 3. Верификация
- [x] `cd apps/backend && go vet ./...`
- [x] `cd apps/backend && go test -count=1 ./...`
- [x] `cd apps/backend && CGO_ENABLED=0 go build -o /dev/null ./cmd/slave`
- [x] `cd apps/backend && CGO_ENABLED=0 go build -o /dev/null ./cmd/master`
- [x] `cd apps/frontend && npm run build`
