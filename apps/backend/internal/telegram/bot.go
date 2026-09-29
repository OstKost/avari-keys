package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

// Bot manages Telegram notifications and command interaction.
type Bot struct {
	apiURL                   string
	token                    string
	botUsername              string
	adminSecret              string
	enabled                  bool
	notifyOnNodeDown         bool
	notifyOnNodeRecover      bool
	notifyOnNewUser          bool
	notifyOnBillingReminders bool

	httpClient  *http.Client
	storage     *storage.Storage
	nodeLister  func(ctx context.Context) ([]models.NodeWithStatus, error)
	statsLister func(ctx context.Context) (*models.DashboardStatsResponse, error)

	stopChan  chan struct{}
	isRunning bool
	wg        sync.WaitGroup
	mu        sync.RWMutex
}

// Config holds Telegram bot parameters.
type Config struct {
	APIURL                   string
	Token                    string
	BotUsername              string
	AdminSecret              string
	AdminChatID              string
	Enabled                  bool
	NotifyOnNodeDown         bool
	NotifyOnNodeRecover      bool
	NotifyOnNewUser          bool
	NotifyOnBillingReminders bool
	Storage                  *storage.Storage
	NodeLister               func(ctx context.Context) ([]models.NodeWithStatus, error)
	StatsLister              func(ctx context.Context) (*models.DashboardStatsResponse, error)
}

// NewBot creates a new Telegram Bot instance.
func NewBot(cfg Config) *Bot {
	apiURL := cfg.APIURL
	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}

	bot := &Bot{
		apiURL:                   apiURL,
		token:                    cfg.Token,
		botUsername:              cfg.BotUsername,
		adminSecret:              cfg.AdminSecret,
		enabled:                  cfg.Enabled || cfg.Token != "",
		notifyOnNodeDown:         true,
		notifyOnNodeRecover:      true,
		notifyOnNewUser:          true,
		notifyOnBillingReminders: true,
		httpClient:               &http.Client{Timeout: 35 * time.Second},
		storage:                  cfg.Storage,
		nodeLister:               cfg.NodeLister,
		statsLister:              cfg.StatsLister,
	}

	// Auto-register initial admin chat if provided in env
	if cfg.AdminChatID != "" && cfg.Storage != nil {
		if id, err := strconv.ParseInt(cfg.AdminChatID, 10, 64); err == nil && id != 0 {
			_ = cfg.Storage.SaveTelegramChat(context.Background(), models.TelegramChat{
				ChatID:        id,
				Username:      "env_admin",
				FirstName:     "Env Admin",
				IsAdmin:       true,
				AlertsEnabled: true,
			})
		}
	}

	return bot
}

// IsEnabled returns true if the bot is enabled and token is present.
func (b *Bot) IsEnabled() bool {
	if b == nil {
		return false
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.enabled && b.token != ""
}

// GetSettings returns the current Telegram settings snapshot.
func (b *Bot) GetSettings() models.TelegramSettings {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return models.TelegramSettings{
		Enabled:                  b.enabled,
		BotToken:                 b.token,
		BotUsername:              b.botUsername,
		AdminSecret:              b.adminSecret,
		NotifyOnNodeDown:         b.notifyOnNodeDown,
		NotifyOnNodeRecover:      b.notifyOnNodeRecover,
		NotifyOnNewUser:          b.notifyOnNewUser,
		NotifyOnBillingReminders: b.notifyOnBillingReminders,
	}
}

// ValidateToken tests the token against Telegram getMe endpoint and returns bot username.
func (b *Bot) ValidateToken(token string) (username string, firstName string, err error) {
	if token == "" {
		return "", "", fmt.Errorf("token cannot be empty")
	}

	b.mu.RLock()
	apiBase := b.apiURL
	b.mu.RUnlock()
	if apiBase == "" {
		apiBase = "https://api.telegram.org"
	}

	url := fmt.Sprintf("%s/bot%s/getMe", apiBase, token)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", "", err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("network error connecting to Telegram API: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("invalid token (Telegram API returned status %d): %s", resp.StatusCode, string(body))
	}

	var meResp struct {
		OK     bool `json:"ok"`
		Result struct {
			ID        int64  `json:"id"`
			IsBot     bool   `json:"is_bot"`
			FirstName string `json:"first_name"`
			Username  string `json:"username"`
		} `json:"result"`
	}

	if err := json.Unmarshal(body, &meResp); err != nil || !meResp.OK {
		return "", "", fmt.Errorf("failed to parse Telegram getMe response: %w", err)
	}

	return meResp.Result.Username, meResp.Result.FirstName, nil
}

// UpdateConfig updates bot credentials and hot-reloads the polling worker.
func (b *Bot) UpdateConfig(ctx context.Context, s models.TelegramSettings) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	tokenChanged := b.token != s.BotToken
	enabledChanged := b.enabled != s.Enabled

	b.token = strings.TrimSpace(s.BotToken)
	b.botUsername = strings.TrimSpace(s.BotUsername)
	b.adminSecret = strings.TrimSpace(s.AdminSecret)
	b.enabled = s.Enabled
	b.notifyOnNodeDown = s.NotifyOnNodeDown
	b.notifyOnNodeRecover = s.NotifyOnNodeRecover
	b.notifyOnNewUser = s.NotifyOnNewUser
	b.notifyOnBillingReminders = s.NotifyOnBillingReminders

	// Hot reload polling worker if token or enabled status changed
	if tokenChanged || enabledChanged {
		if b.isRunning {
			close(b.stopChan)
			b.wg.Wait()
			b.isRunning = false
			log.Printf("[TELEGRAM] Stopped previous polling worker")
		}

		if b.enabled && b.token != "" {
			b.stopChan = make(chan struct{})
			b.isRunning = true
			b.wg.Add(1)
			// Always run polling with long-lived background context
			go b.pollUpdates(context.Background())
			log.Printf("[TELEGRAM] Hot-reloaded and started polling worker for @%s", b.botUsername)
		}
	}

	return nil
}

// Start launches the background polling worker.
func (b *Bot) Start(ctx context.Context) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.enabled || b.token == "" {
		log.Println("[TELEGRAM] Bot token not provided or bot disabled, Telegram notifications inactive")
		return
	}

	if b.isRunning {
		return
	}

	b.stopChan = make(chan struct{})
	b.isRunning = true
	b.wg.Add(1)
	// Always run polling with long-lived background context
	go b.pollUpdates(context.Background())
	log.Printf("[TELEGRAM] Bot @%s started successfully (Polling)", b.botUsername)
}

// Stop gracefully terminates the polling loop.
func (b *Bot) Stop() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.isRunning {
		return
	}

	close(b.stopChan)
	b.wg.Wait()
	b.isRunning = false
	log.Printf("[TELEGRAM] Bot @%s stopped", b.botUsername)
}

// InlineKeyboardButton represents an inline keyboard button in Telegram Bot API.
type InlineKeyboardButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data,omitempty"`
	URL          string `json:"url,omitempty"`
}

// InlineKeyboardMarkup represents inline keyboard reply markup.
type InlineKeyboardMarkup struct {
	InlineKeyboard [][]InlineKeyboardButton `json:"inline_keyboard"`
}

// TGUser represents Telegram user object.
type TGUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

// TGChat represents Telegram chat object.
type TGChat struct {
	ID        int64  `json:"id"`
	Type      string `json:"type"`
	Title     string `json:"title,omitempty"`
	Username  string `json:"username,omitempty"`
	FirstName string `json:"first_name,omitempty"`
}

// TGMessage represents Telegram message object.
type TGMessage struct {
	MessageID int64   `json:"message_id"`
	From      *TGUser `json:"from,omitempty"`
	Chat      TGChat  `json:"chat"`
	Text      string  `json:"text,omitempty"`
	Date      int64   `json:"date,omitempty"`
}

// TGCallbackQuery represents incoming Telegram Callback Query (inline button click).
type TGCallbackQuery struct {
	ID      string     `json:"id"`
	From    TGUser     `json:"from"`
	Message *TGMessage `json:"message,omitempty"`
	Data    string     `json:"data"`
}

// TGUpdate represents incoming Telegram Update.
type TGUpdate struct {
	UpdateID      int64            `json:"update_id"`
	Message       *TGMessage       `json:"message,omitempty"`
	CallbackQuery *TGCallbackQuery `json:"callback_query,omitempty"`
}

type TGUpdatesResponse struct {
	OK     bool       `json:"ok"`
	Result []TGUpdate `json:"result"`
}

func (b *Bot) pollUpdates(ctx context.Context) {
	defer b.wg.Done()

	var offset int64 = 0

	for {
		b.mu.RLock()
		token := b.token
		stopCh := b.stopChan
		apiBase := b.apiURL
		b.mu.RUnlock()

		if token == "" {
			return
		}
		if apiBase == "" {
			apiBase = "https://api.telegram.org"
		}

		select {
		case <-stopCh:
			return
		case <-ctx.Done():
			return
		default:
		}

		url := fmt.Sprintf("%s/bot%s/getUpdates?timeout=25&offset=%d", apiBase, token, offset)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			time.Sleep(3 * time.Second)
			continue
		}

		resp, err := b.httpClient.Do(req)
		if err != nil {
			select {
			case <-stopCh:
				return
			case <-time.After(3 * time.Second):
				continue
			}
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			time.Sleep(3 * time.Second)
			continue
		}

		var updateRes TGUpdatesResponse
		if err := json.Unmarshal(body, &updateRes); err != nil || !updateRes.OK {
			time.Sleep(2 * time.Second)
			continue
		}

		for _, upd := range updateRes.Result {
			offset = upd.UpdateID + 1
			if upd.Message != nil && upd.Message.Text != "" {
				b.handleIncomingMessage(ctx, upd.Message.Chat.ID, upd.Message.From, upd.Message.Text)
			}
			if upd.CallbackQuery != nil {
				b.handleCallbackQuery(ctx, upd.CallbackQuery)
			}
		}
	}
}

func (b *Bot) handleIncomingMessage(ctx context.Context, chatID int64, from *TGUser, text string) {
	username := ""
	firstName := ""
	if from != nil {
		username = from.Username
		firstName = from.FirstName
	}

	text = strings.TrimSpace(text)
	parts := strings.Fields(text)
	if len(parts) == 0 {
		return
	}

	command := strings.ToLower(parts[0])
	if idx := strings.Index(command, "@"); idx != -1 {
		command = command[:idx]
	}

	b.mu.RLock()
	adminSecret := b.adminSecret
	botUsername := b.botUsername
	b.mu.RUnlock()

	// 1. Check if this is a /start command with an individual link token or admin secret parameter
	if command == "/start" && len(parts) > 1 {
		param := parts[1]

		// Admin secret matching
		if adminSecret != "" && param == adminSecret {
			b.registerChat(ctx, chatID, nil, username, firstName, true)
			_ = b.SendMessage(chatID, "✨ <b>Добро пожаловать в Avari Keys Alerts!</b>\n\nВаш чат успешно привязан с правами <b>Администратора</b>.\nВы будете получать оповещения о доступности серверов и событиях системы.\n\nИспользуйте /status для проверки серверов или /help для списка команд.", "HTML")
			return
		}

		// Individual user link token matching
		cleanToken := strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(param, "link_"), "bind_"), "user_")
		if b.storage != nil && cleanToken != "" {
			user, err := b.storage.GetUserByTelegramLinkToken(ctx, cleanToken)
			if err == nil && user != nil && user.IsActive {
				isAdmin := user.Role == models.RoleAdmin
				_ = b.storage.SaveTelegramChat(ctx, models.TelegramChat{
					ChatID:        chatID,
					UserID:        &user.ID,
					Username:      username,
					FirstName:     firstName,
					IsAdmin:       isAdmin,
					AlertsEnabled: true,
				})
				_ = b.storage.ConsumeTelegramLinkToken(ctx, cleanToken)

				msg := fmt.Sprintf("✨ <b>Добро пожаловать в Avari Keys!</b>\n\nВаш чат успешно привязан к аккаунту <b>%s</b>.\nВы будете получать уведомления о состоянии ключей и напоминания о взносах.\n\nИспользуйте /billing для проверки статуса взноса или /status для проверки сети.", user.Username)
				_ = b.SendMessage(chatID, msg, "HTML")
				return
			}
		}

		// Invalid or expired token -> respond with decoy for unknown users
		_ = b.SendMessage(chatID, "Привет! Как дела?", "")
		return
	}

	// 2. Check if the chat is already linked to an active user or admin
	var currentChat *models.TelegramChat
	if b.storage != nil {
		currentChat, _ = b.storage.GetTelegramChatByChatID(ctx, chatID)
	}

	isAuthorized := false
	if currentChat != nil {
		if currentChat.IsAdmin {
			isAuthorized = true
		} else if currentChat.UserID != nil && b.storage != nil {
			users, err := b.storage.ListUsers(ctx)
			if err == nil {
				for _, u := range users {
					if u.ID == *currentChat.UserID && u.IsActive {
						isAuthorized = true
						break
					}
				}
			}
		}
	}

	// 3. If user is unknown / not linked: send simple polite decoy message
	if !isAuthorized {
		_ = b.SendMessage(chatID, "Привет! Как дела?", "")
		return
	}

	// 4. Authorized user command handling
	switch command {
	case "/start":
		botHeader := "🌿 <b>Avari Keys Bot</b>"
		if botUsername != "" {
			botHeader = "🌿 <b>Avari Keys Bot (@" + botUsername + ")</b>"
		}
		msg := botHeader + "\n\n" +
			"Бот активен и готов присылать мгновенные уведомления о состоянии серверов и напоминания о кооперативных взносах.\n\n" +
			"<b>Доступные команды:</b>\n" +
			"💳 /billing — Статус взносов, расчет и реквизиты СБП\n" +
			"📊 /status — Состояние и пинг всех серверов сети\n" +
			"🌐 /nodes — Список серверов и маршрутизация\n" +
			"🔔 /test — Проверить доставку оповещения\n" +
			"🚪 /logout — Отвязать Telegram-чат от аккаунта\n" +
			"❓ /help — Справка по командам"
		_ = b.SendMessage(chatID, msg, "HTML")

	case "/logout", "/unlink", "/disconnect":
		if b.storage != nil {
			_ = b.storage.DeleteTelegramChat(ctx, chatID)
		}
		msg := "👋 <b>Чат отвязан</b>\n\n" +
			"Ваш Telegram-чат успешно отвязан от учетной записи Avari Keys.\n" +
			"Чтобы подключиться снова, перейдите в веб-панель и нажмите кнопку подключения по персональной ссылке."
		_ = b.SendMessage(chatID, msg, "HTML")

	case "/billing", "/dues":
		b.handleBillingCommand(ctx, chatID)

	case "/status":
		b.handleStatusCommand(ctx, chatID)

	case "/nodes":
		b.handleNodesCommand(ctx, chatID)

	case "/test":
		_ = b.SendTestAlert(chatID)

	case "/help":
		msg := "📖 <b>Справка Avari Keys Bot</b>\n\n" +
			"• <b>/billing</b> — Статус взносов, расчет по ключам и реквизиты СБП\n" +
			"• <b>/status</b> — Текущий статус серверов и задержка (пинг)\n" +
			"• <b>/nodes</b> — Список узлов и их конфигурация\n" +
			"• <b>/logout</b> — Отвязать Telegram-чат от учетной записи\n" +
			"• <b>/test</b> — Тестовое оповещение о доставке\n" +
			"• <b>/start</b> — Главное меню"
		_ = b.SendMessage(chatID, msg, "HTML")

	default:
		_ = b.SendMessage(chatID, "Неизвестная команда. Введите /help для списка команд.", "")
	}
}

func (b *Bot) registerChat(ctx context.Context, chatID int64, userID *int64, username, firstName string, isAdmin bool) {
	if b.storage == nil {
		return
	}
	_ = b.storage.SaveTelegramChat(ctx, models.TelegramChat{
		ChatID:        chatID,
		UserID:        userID,
		Username:      username,
		FirstName:     firstName,
		IsAdmin:       isAdmin,
		AlertsEnabled: true,
	})
}

func (b *Bot) handleBillingCommand(ctx context.Context, chatID int64) {
	if b.storage == nil {
		_ = b.SendMessage(chatID, "⚠️ База данных биллинга недоступна.", "")
		return
	}

	chats, _ := b.storage.ListTelegramChats(ctx)
	var linkedUserID *int64
	for _, c := range chats {
		if c.ChatID == chatID && c.UserID != nil {
			linkedUserID = c.UserID
			break
		}
	}

	if linkedUserID == nil {
		msg := "ℹ️ <b>Привязка аккаунта к Telegram</b>\n\n" +
			"Ваш Telegram-чат пока не привязан к аккаунту Avari Keys.\n" +
			"Чтобы привязать аккаунт и проверять взносы, отправьте:\n" +
			"<code>/link &lt;ваш_логин&gt;</code>\n\n" +
			"<i>Например: <code>/link Forve</code></i>"
		_ = b.SendMessage(chatID, msg, "HTML")
		return
	}

	status, err := b.storage.GetBillingStatus(ctx, *linkedUserID)
	if err != nil {
		_ = b.SendMessage(chatID, fmt.Sprintf("⚠️ Ошибка получения данных биллинга: %v", err), "")
		return
	}

	reqs, _ := b.storage.GetBillingRequisites(ctx)
	phone := "+7 (999) 000-00-00"
	bank := "Т-Банк / Сбербанк"
	if reqs != nil {
		if reqs.SBPPhone != "" {
			phone = reqs.SBPPhone
		}
		if reqs.SBPBank != "" {
			bank = reqs.SBPBank
		}
	}

	statusEmoji := "🟢"
	statusText := "Оплачено"
	if status.IsDue {
		statusEmoji = "🔴"
		statusText = "Требуется взнос"
	} else if status.Status == "snoozed" {
		statusEmoji = "🟡"
		statusText = "Отложено"
	}

	dueText := fmt.Sprintf("осталось <b>%d дн.</b> (до %s)", status.DaysRemaining, status.NextDueAt.Format("02.01.2006"))
	if status.IsDue || status.DaysRemaining <= 0 {
		dueText = fmt.Sprintf("<b>Срок наступил (%s)</b>", status.NextDueAt.Format("02.01.2006"))
	}

	msg := fmt.Sprintf(
		"💳 <b>Статус взносов Avari Keys</b>\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n"+
			"Статус: %s <b>%s</b>\n"+
			"🔑 Активных VPN-ключей: <b>%d</b>\n"+
			"💰 Рекомендуемый взнос: <b>%.0f ₽ / мес</b>\n"+
			"<i>(Базовый тариф: 200 ₽ за 3 ключа + 30 ₽ за каждый доп. ключ)</i>\n\n"+
			"⏳ Срок взноса: %s\n\n"+
			"📱 <b>Реквизиты для перевода (СБП):</b>\n"+
			"├ Телефон: <code>%s</code>\n"+
			"└ Банк: <b>%s</b>\n\n"+
			"<i>Сумма взноса является добровольной и ориентировочной. Спасибо за поддержку сети! ✨</i>",
		statusEmoji, statusText, status.KeyCount, status.RecommendedAmount, dueText, phone, bank,
	)
	_ = b.SendMessage(chatID, msg, "HTML")
}

func (b *Bot) handleStatusCommand(ctx context.Context, chatID int64) {
	if b.nodeLister == nil {
		_ = b.SendMessage(chatID, "⚠️ Сервис мониторинга узлов недоступен.", "")
		return
	}

	nodes, err := b.nodeLister(ctx)
	if err != nil {
		_ = b.SendMessage(chatID, fmt.Sprintf("⚠️ Ошибка получения статуса узлов: %v", err), "")
		return
	}

	onlineCount := 0
	totalCount := len(nodes)

	var sb strings.Builder
	sb.WriteString("📊 <b>Статус узлов Avari Keys</b>\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━\n\n")

	for _, n := range nodes {
		statusEmoji := "🟢"
		statusText := fmt.Sprintf("Online (%d ms)", n.LatencyMs)
		if !n.Online {
			statusEmoji = "🔴"
			statusText = "Offline / Не отвечает"
		} else {
			onlineCount++
		}

		typeLabel := "Direct"
		if n.Type == "cascade" {
			typeLabel = "Cascade"
		}

		sb.WriteString(fmt.Sprintf("%s <b>%s</b> [%s]\n", statusEmoji, n.Name, typeLabel))
		sb.WriteString(fmt.Sprintf("   └ Статус: <code>%s</code>\n", statusText))
		if n.CountryCode != "" {
			sb.WriteString(fmt.Sprintf("   └ Страна: <code>%s</code>\n", n.CountryCode))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━\n")
	sb.WriteString(fmt.Sprintf("Всего серверов: <b>%d/%d онлайн</b>\n", onlineCount, totalCount))
	sb.WriteString(fmt.Sprintf("🕒 Проверено: <code>%s</code>", time.Now().Format("02.01.2006 15:04:05")))

	_ = b.SendMessage(chatID, sb.String(), "HTML")
}

func (b *Bot) handleNodesCommand(ctx context.Context, chatID int64) {
	if b.nodeLister == nil {
		_ = b.SendMessage(chatID, "⚠️ Данные узлов недоступны.", "")
		return
	}

	nodes, err := b.nodeLister(ctx)
	if err != nil {
		_ = b.SendMessage(chatID, fmt.Sprintf("⚠️ Ошибка: %v", err), "")
		return
	}

	var sb strings.Builder
	sb.WriteString("🌐 <b>Список серверов Avari Keys</b>\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━\n\n")

	for i, n := range nodes {
		mob := ""
		if n.IsMobileOptimized {
			mob = " 📱 [Mobile Opt]"
		}
		sb.WriteString(fmt.Sprintf("<b>%d. %s</b>%s\n", i+1, n.Name, mob))
		sb.WriteString(fmt.Sprintf("   • ID: <code>#%d</code>\n", n.ID))
		sb.WriteString(fmt.Sprintf("   • Тип: <code>%s</code>\n", n.Type))
		if n.CountryCode != "" {
			sb.WriteString(fmt.Sprintf("   • Страна: <code>%s</code>\n", n.CountryCode))
		}
		sb.WriteString(fmt.Sprintf("   • URL: <code>%s</code>\n", n.APIURL))
		sb.WriteString("\n")
	}

	_ = b.SendMessage(chatID, sb.String(), "HTML")
}

// ProcessMessage handles an incoming chat message (useful for direct testing and webhook integrations).
func (b *Bot) ProcessMessage(ctx context.Context, chatID int64, fromUsername, fromFirstName, text string) {
	var from *TGUser
	if fromUsername != "" || fromFirstName != "" {
		from = &TGUser{
			FirstName: fromFirstName,
			Username:  fromUsername,
		}
	}
	b.handleIncomingMessage(ctx, chatID, from, text)
}

// ProcessCallbackQuery processes an incoming callback query directly (useful for testing or webhook mode).
func (b *Bot) ProcessCallbackQuery(ctx context.Context, cb *TGCallbackQuery) {
	b.handleCallbackQuery(ctx, cb)
}

func (b *Bot) handleCallbackQuery(ctx context.Context, cb *TGCallbackQuery) {
	if cb == nil {
		return
	}

	// 1. Verify caller authorization: must be registered admin
	var currentChat *models.TelegramChat
	if b.storage != nil {
		currentChat, _ = b.storage.GetTelegramChatByChatID(ctx, cb.From.ID)
	}

	isAdmin := false
	if currentChat != nil && currentChat.IsAdmin {
		isAdmin = true
	}

	if !isAdmin {
		_ = b.AnswerCallbackQuery(cb.ID, "⛔ У вас нет прав администратора для выполнения этого действия", true)
		return
	}

	adminName := cb.From.Username
	if adminName == "" {
		adminName = cb.From.FirstName
	}
	if adminName == "" {
		adminName = fmt.Sprintf("ID#%d", cb.From.ID)
	}

	// 2. Route callback action
	switch {
	case strings.HasPrefix(cb.Data, "approve_user:"):
		idStr := strings.TrimPrefix(cb.Data, "approve_user:")
		userID, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			_ = b.AnswerCallbackQuery(cb.ID, "Некорректный ID пользователя", true)
			return
		}

		if b.storage == nil {
			_ = b.AnswerCallbackQuery(cb.ID, "База данных недоступна", true)
			return
		}

		user, err := b.storage.GetUserByID(ctx, userID)
		if err != nil || user == nil {
			_ = b.AnswerCallbackQuery(cb.ID, "Пользователь не найден", true)
			return
		}

		if user.IsActive {
			_ = b.AnswerCallbackQuery(cb.ID, fmt.Sprintf("Пользователь @%s уже активирован", user.Username), false)
			if cb.Message != nil {
				updatedText := fmt.Sprintf(
					"👤 <b>[Avari Keys] Новый пользователь!</b>\n"+
						"━━━━━━━━━━━━━━━━━━━━━\n"+
						"Пользователь: <b>@%s</b> (ID #%d)\n"+
						"Статус: 🟢 <b>Одобрен</b> (модератор: @%s)\n"+
						"Дата: %s",
					user.Username,
					user.ID,
					adminName,
					user.CreatedAt.Format("02.01.2006 15:04:05"),
				)
				_ = b.EditMessageText(cb.Message.Chat.ID, cb.Message.MessageID, updatedText, "HTML", InlineKeyboardMarkup{InlineKeyboard: [][]InlineKeyboardButton{}})
			}
			return
		}

		if err := b.storage.SetUserActive(ctx, userID, true); err != nil {
			_ = b.AnswerCallbackQuery(cb.ID, fmt.Sprintf("Ошибка активации: %v", err), true)
			return
		}

		_ = b.storage.CreateAuditLog(ctx, &models.AuditLog{
			Username: "tg:@" + adminName,
			Action:   "admin_user_activate_tg",
			Category: models.CategoryAdmin,
			Details:  fmt.Sprintf("Пользователь «%s» (ID #%d) активирован администратором через Telegram (@%s)", user.Username, user.ID, adminName),
		})

		_ = b.AnswerCallbackQuery(cb.ID, fmt.Sprintf("✅ Пользователь @%s успешно одобрен!", user.Username), false)

		if cb.Message != nil {
			updatedText := fmt.Sprintf(
				"👤 <b>[Avari Keys] Новый пользователь!</b>\n"+
					"━━━━━━━━━━━━━━━━━━━━━\n"+
					"Пользователь: <b>@%s</b> (ID #%d)\n"+
					"Статус: 🟢 <b>Одобрен</b> (модератор: @%s)\n"+
					"Дата: %s",
				user.Username,
				user.ID,
				adminName,
				user.CreatedAt.Format("02.01.2006 15:04:05"),
			)
			_ = b.EditMessageText(cb.Message.Chat.ID, cb.Message.MessageID, updatedText, "HTML", InlineKeyboardMarkup{InlineKeyboard: [][]InlineKeyboardButton{}})
		}

		// Notify user if their Telegram account is linked
		userChat, _ := b.storage.GetTelegramChatByUserID(ctx, user.ID)
		if userChat != nil {
			_ = b.SendMessage(userChat.ChatID, "🎉 <b>Ваш аккаунт активирован!</b>\n\nАдминистратор подтвердил вашу учетную запись в Avari Keys.\nТеперь вы можете перейти в панель управления и создать VPN-ключ.", "HTML")
		}

	case strings.HasPrefix(cb.Data, "reject_user:"):
		idStr := strings.TrimPrefix(cb.Data, "reject_user:")
		userID, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			_ = b.AnswerCallbackQuery(cb.ID, "Некорректный ID пользователя", true)
			return
		}

		if b.storage == nil {
			_ = b.AnswerCallbackQuery(cb.ID, "База данных недоступна", true)
			return
		}

		user, err := b.storage.GetUserByID(ctx, userID)
		if err != nil || user == nil {
			_ = b.AnswerCallbackQuery(cb.ID, "Пользователь не найден", true)
			return
		}

		_ = b.storage.SetUserActive(ctx, userID, false)

		_ = b.storage.CreateAuditLog(ctx, &models.AuditLog{
			Username: "tg:@" + adminName,
			Action:   "admin_user_reject_tg",
			Category: models.CategoryAdmin,
			Details:  fmt.Sprintf("Пользователю «%s» (ID #%d) отказано в активации через Telegram (@%s)", user.Username, user.ID, adminName),
		})

		_ = b.AnswerCallbackQuery(cb.ID, fmt.Sprintf("❌ Пользователь @%s отклонен", user.Username), false)

		if cb.Message != nil {
			updatedText := fmt.Sprintf(
				"👤 <b>[Avari Keys] Новый пользователь!</b>\n"+
					"━━━━━━━━━━━━━━━━━━━━━\n"+
					"Пользователь: <b>@%s</b> (ID #%d)\n"+
					"Статус: 🔴 <b>Отклонен</b> (модератор: @%s)\n"+
					"Дата: %s",
				user.Username,
				user.ID,
				adminName,
				user.CreatedAt.Format("02.01.2006 15:04:05"),
			)
			_ = b.EditMessageText(cb.Message.Chat.ID, cb.Message.MessageID, updatedText, "HTML", InlineKeyboardMarkup{InlineKeyboard: [][]InlineKeyboardButton{}})
		}

	default:
		_ = b.AnswerCallbackQuery(cb.ID, "Неизвестное действие", false)
	}
}

// SendMessage sends an individual text message via Telegram API.
func (b *Bot) SendMessage(chatID int64, text string, parseMode string) error {
	return b.SendMessageWithMarkup(chatID, text, parseMode, nil)
}

// SendMessageWithMarkup sends an individual text message with optional reply_markup via Telegram API.
func (b *Bot) SendMessageWithMarkup(chatID int64, text string, parseMode string, markup any) error {
	b.mu.RLock()
	token := b.token
	enabled := b.enabled
	apiBase := b.apiURL
	b.mu.RUnlock()

	if !enabled || token == "" {
		return fmt.Errorf("telegram bot is not configured or disabled")
	}
	if apiBase == "" {
		apiBase = "https://api.telegram.org"
	}

	payload := map[string]any{
		"chat_id": chatID,
		"text":    text,
	}
	if parseMode != "" {
		payload["parse_mode"] = parseMode
	}
	if markup != nil {
		payload["reply_markup"] = markup
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/bot%s/sendMessage", apiBase, token)
	resp, err := b.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to send telegram message: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// AnswerCallbackQuery sends a response to an incoming callback query.
func (b *Bot) AnswerCallbackQuery(callbackQueryID, text string, showAlert bool) error {
	b.mu.RLock()
	token := b.token
	enabled := b.enabled
	apiBase := b.apiURL
	b.mu.RUnlock()

	if !enabled || token == "" {
		return fmt.Errorf("telegram bot is not configured or disabled")
	}
	if apiBase == "" {
		apiBase = "https://api.telegram.org"
	}

	payload := map[string]any{
		"callback_query_id": callbackQueryID,
	}
	if text != "" {
		payload["text"] = text
	}
	if showAlert {
		payload["show_alert"] = true
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/bot%s/answerCallbackQuery", apiBase, token)
	resp, err := b.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to answer callback query: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// EditMessageText edits existing message text and optionally updates or removes reply_markup.
func (b *Bot) EditMessageText(chatID, messageID int64, text, parseMode string, markup any) error {
	b.mu.RLock()
	token := b.token
	enabled := b.enabled
	apiBase := b.apiURL
	b.mu.RUnlock()

	if !enabled || token == "" {
		return fmt.Errorf("telegram bot is not configured or disabled")
	}
	if apiBase == "" {
		apiBase = "https://api.telegram.org"
	}

	payload := map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
		"text":       text,
	}
	if parseMode != "" {
		payload["parse_mode"] = parseMode
	}
	if markup != nil {
		payload["reply_markup"] = markup
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/bot%s/editMessageText", apiBase, token)
	resp, err := b.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to edit message text: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// BroadcastAlert sends an alert to all registered subscribers.
func (b *Bot) BroadcastAlert(text string) error {
	return b.BroadcastAlertWithMarkup(text, nil)
}

// BroadcastAlertWithMarkup sends an alert with optional inline markup to registered admin subscribers.
func (b *Bot) BroadcastAlertWithMarkup(text string, markup any) error {
	if !b.IsEnabled() || b.storage == nil {
		return nil
	}

	chats, err := b.storage.ListTelegramChats(context.Background())
	if err != nil {
		return err
	}

	var lastErr error
	for _, c := range chats {
		if !c.AlertsEnabled {
			continue
		}
		if err := b.SendMessageWithMarkup(c.ChatID, text, "HTML", markup); err != nil {
			log.Printf("[TELEGRAM] Failed to send alert to chat %d: %v", c.ChatID, err)
			lastErr = err
		}
	}
	return lastErr
}

// NotifyNodeDown sends a critical downtime alert.
func (b *Bot) NotifyNodeDown(node models.Node, reason string) {
	b.mu.RLock()
	notify := b.notifyOnNodeDown
	b.mu.RUnlock()

	if !notify {
		return
	}

	msg := fmt.Sprintf(
		"🚨 <b>[Avari Alert] СЕРВЕР НЕДОСТУПЕН!</b>\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n"+
			"📍 <b>Сервер:</b> %s (ID #%d)\n"+
			"🌐 <b>Тип:</b> %s\n"+
			"🏳️ <b>Локация:</b> %s\n"+
			"🔗 <b>API URL:</b> <code>%s</code>\n"+
			"⚠️ <b>Ошибка:</b> <code>%s</code>\n"+
			"⏱ <b>Время:</b> %s\n\n"+
			"<i>Проверьте статус сервера или перезапустите службу AWG в панели управления.</i>",
		node.Name,
		node.ID,
		node.Type,
		node.CountryCode,
		node.APIURL,
		reason,
		time.Now().Format("02.01.2006 15:04:05"),
	)
	_ = b.BroadcastAlert(msg)
}

// NotifyNodeRecovered sends a recovery notification.
func (b *Bot) NotifyNodeRecovered(node models.Node, latencyMs int64) {
	b.mu.RLock()
	notify := b.notifyOnNodeRecover
	b.mu.RUnlock()

	if !notify {
		return
	}

	msg := fmt.Sprintf(
		"✅ <b>[Avari Alert] СЕРВЕР СНОВА ОНЛАЙН!</b>\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n"+
			"📍 <b>Сервер:</b> %s (ID #%d)\n"+
			"🌐 <b>Тип:</b> %s\n"+
			"⚡ <b>Задержка:</b> %d ms\n"+
			"⏱ <b>Время восстановления:</b> %s\n\n"+
			"<i>Сервер успешно отвечает на запросы и готов к обслуживанию клиентов.</i>",
		node.Name,
		node.ID,
		node.Type,
		latencyMs,
		time.Now().Format("02.01.2006 15:04:05"),
	)
	_ = b.BroadcastAlert(msg)
}

// NotifyNewUser sends an alert about new user registration pending approval with inline action buttons.
func (b *Bot) NotifyNewUser(user models.User) {
	b.mu.RLock()
	notify := b.notifyOnNewUser
	b.mu.RUnlock()

	if !notify {
		return
	}

	msg := fmt.Sprintf(
		"👤 <b>[Avari Keys] Новый пользователь!</b>\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n"+
			"Пользователь: <b>@%s</b> (ID #%d)\n"+
			"Статус: 🟡 <b>Ожидает модерации</b>\n"+
			"Дата: %s\n\n"+
			"<i>Нажмите кнопку ниже или используйте веб-панель для модерации.</i>",
		user.Username,
		user.ID,
		user.CreatedAt.Format("02.01.2006 15:04:05"),
	)

	keyboard := InlineKeyboardMarkup{
		InlineKeyboard: [][]InlineKeyboardButton{
			{
				{Text: "✅ Одобрить", CallbackData: fmt.Sprintf("approve_user:%d", user.ID)},
				{Text: "❌ Отклонить", CallbackData: fmt.Sprintf("reject_user:%d", user.ID)},
			},
		},
	}

	_ = b.BroadcastAlertWithMarkup(msg, keyboard)
}

// SendTestAlert sends a test message to a specific chat or broadcasts.
func (b *Bot) SendTestAlert(chatID int64) error {
	b.mu.RLock()
	botUsername := b.botUsername
	b.mu.RUnlock()

	msg := fmt.Sprintf(
		"🔔 <b>[Avari Test Alert] Проверка связи с ботом @%s</b>\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n"+
			"✅ Бот успешно подключен к Master-серверу.\n"+
			"📡 Оповещения о статусе серверов и падениях настроены.\n"+
			"💳 Напоминания о взносах активны.\n"+
			"⏱ <b>Время:</b> %s",
		botUsername,
		time.Now().Format("02.01.2006 15:04:05"),
	)

	if chatID != 0 {
		return b.SendMessage(chatID, msg, "HTML")
	}
	return b.BroadcastAlert(msg)
}

// SendBillingReminder sends a personal dues reminder to a user's Telegram chat.
func (b *Bot) SendBillingReminder(chatID int64, username string, keyCount int, amount float64, daysRemaining int, reqs *models.BillingRequisites) error {
	b.mu.RLock()
	notify := b.notifyOnBillingReminders
	b.mu.RUnlock()

	if !notify {
		return nil
	}

	phone := "+7 (999) 000-00-00"
	bank := "Т-Банк / Сбербанк"
	if reqs != nil {
		if reqs.SBPPhone != "" {
			phone = reqs.SBPPhone
		}
		if reqs.SBPBank != "" {
			bank = reqs.SBPBank
		}
	}

	dueText := "срок оплаты наступил!"
	if daysRemaining > 0 {
		dueText = fmt.Sprintf("осталось <b>%d дн.</b>", daysRemaining)
	}

	msg := fmt.Sprintf(
		"🌿 <b>[Avari Keys] Напоминание о кооперативном взносе</b>\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n"+
			"Здравствуйте, <b>%s</b>!\n\n"+
			"Подходит срок ежемесячного взноса за серверную инфраструктуру Avari Keys (%s).\n\n"+
			"🔑 Ваших активных ключей: <b>%d</b>\n"+
			"💳 Рекомендуемый взнос: <b>%.0f ₽</b>\n"+
			"<i>(Базовый тариф: 200 ₽ за 3 ключа + 30 ₽ за каждый доп. ключ)</i>\n\n"+
			"📱 <b>Реквизиты для взноса (СБП):</b>\n"+
			"├ Телефон: <code>%s</code>\n"+
			"└ Банк: <b>%s</b>\n\n"+
			"<i>Взнос является добровольной поддержкой серверной инфраструктуры. Спасибо за участие в сети! ✨</i>",
		username, dueText, keyCount, amount, phone, bank,
	)
	return b.SendMessage(chatID, msg, "HTML")
}

// BroadcastBillingReminders checks users needing payment and sends notifications.
func (b *Bot) BroadcastBillingReminders(ctx context.Context) error {
	if !b.IsEnabled() || b.storage == nil {
		return nil
	}

	b.mu.RLock()
	notify := b.notifyOnBillingReminders
	b.mu.RUnlock()

	if !notify {
		return nil
	}

	users, err := b.storage.ListUsers(ctx)
	if err != nil {
		return err
	}

	reqs, _ := b.storage.GetBillingRequisites(ctx)

	for _, u := range users {
		if !u.IsActive {
			continue
		}

		chat, err := b.storage.GetTelegramChatByUserID(ctx, u.ID)
		if err != nil || chat == nil || !chat.AlertsEnabled {
			continue
		}

		st, sErr := b.storage.GetBillingStatus(ctx, u.ID)
		if sErr != nil {
			continue
		}

		// Send reminder if 3 days or less remaining or overdue
		if st.IsDue || st.DaysRemaining <= 3 {
			_ = b.SendBillingReminder(chat.ChatID, u.Username, st.KeyCount, st.RecommendedAmount, st.DaysRemaining, reqs)
		}
	}

	return nil
}

// BroadcastNews sends a published announcement to all registered subscribers with alerts enabled.
func (b *Bot) BroadcastNews(item models.NewsItem) error {
	if !b.IsEnabled() || b.storage == nil {
		return nil
	}

	emoji := "📢"
	categoryLabel := "Новости сети"
	switch item.Category {
	case models.NewsCategoryMaintenance:
		emoji = "🛠️"
		categoryLabel = "Технические работы"
	case models.NewsCategoryIncident:
		emoji = "🚨"
		categoryLabel = "Важное / Сбой"
	case models.NewsCategoryBilling:
		emoji = "💳"
		categoryLabel = "Оплата и взносы"
	case models.NewsCategoryKeys:
		emoji = "🔑"
		categoryLabel = "Обновление ключей"
	case models.NewsCategoryGeneral:
		emoji = "📢"
		categoryLabel = "Новости сети"
	}

	pinBadge := ""
	if item.IsPinned {
		pinBadge = " 📌 [ЗАКРЕПЛЕНО]"
	}

	author := item.AuthorName
	if author == "" {
		author = "Администрация"
	}

	escapedTitle := html.EscapeString(item.Title)
	escapedContent := html.EscapeString(item.Content)
	createdAtStr := item.CreatedAt.Format("02.01.2006 15:04")
	if item.CreatedAt.IsZero() {
		createdAtStr = time.Now().Format("02.01.2006 15:04")
	}

	msg := fmt.Sprintf(
		"%s <b>[Avari Новости]%s %s</b>\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n\n"+
			"%s\n\n"+
			"━━━━━━━━━━━━━━━━━━━━━\n"+
			"🏷️ <i>Категория: %s • Автор: @%s • %s</i>",
		emoji, pinBadge, escapedTitle,
		escapedContent,
		categoryLabel, author, createdAtStr,
	)

	return b.BroadcastAlert(msg)
}

