import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4321;
const OUTPUT_DIR = path.resolve('../../_docs/screenshots');

const CARDS_CONFIG = [
  {
    filename: '01-login-screen.png',
    badge: '🛡️ БЕЗОПАСНЫЙ ДОСТУП • АВТОРИЗАЦИЯ',
    title: 'Вход в систему, регистрация и гостевой Демо-режим',
    bullets: [
      'Демо-доступ в 1 клик для ролей «Администратор» и «Пользователь»',
      'Защищенная регистрация: новые аккаунты требуют подтверждения',
      'Запрос сброса пароля с одобрением через Telegram-бота и веб-панель'
    ],
    tech: ['Zero CGo', 'JWT + Bcrypt', 'Decoy Route'],
    url: 'keys.avari.dev/login'
  },
  {
    filename: '02-dashboard-keys.png',
    badge: '📱 ЛИЧНЫЙ КАБИНЕТ • УСТРОЙСТВА',
    title: 'Управление VPN-ключами и активными подключениями',
    bullets: [
      'Отображение типа подключения: Каскад (M0 → S1/S4) или Direct (S2, S5P)',
      'Учет трафика через Curve25519 деривацию и статус рукопожатий',
      'Интеграция с Telegram-ботом через персональные защищенные Deep Links'
    ],
    tech: ['AmneziaWG', 'Hysteria 2', 'Telegram Sync'],
    url: 'keys.avari.dev/keys'
  },
  {
    filename: '03-key-qr-modal.png',
    badge: '⚡ ОБФУСКАЦИЯ DPI • ИМПОРТ КЛЮЧЕЙ',
    title: 'Модальное окно конфигурации AmneziaWG и QR-код',
    bullets: [
      'Мгновенный импорт по QR-коду для iOS / Android приложения AmneziaWG',
      'Кастомные параметры защиты от DPI: Jc, Jmin, Jmax, S1, S2, H1-H4',
      'Zero-Knowledge изоляция: приватные ключи не сохраняются в БД Master'
    ],
    tech: ['DPI Protection', 'QR Vector', 'Zero-Knowledge'],
    url: 'keys.avari.dev/keys#modal-config'
  },
  {
    filename: '04-network-dashboard.png',
    badge: '🛰️ ТОПОЛОГИЯ КЛАСТЕРА • ТЕЛЕМЕТРИЯ',
    title: 'Статус серверов, пинг и активный каскад',
    bullets: [
      'Мониторинг узлов: РФ Ingress (M0), Премиум (S5P), Egress (S1, S4), Direct (S2)',
      'Независимые пробы сети: пинг, статус доступности и протоколы',
      'Отображение фактического Egress-выхода каскада в реальном времени'
    ],
    tech: ['Overlay Probes', 'Latency Engine', 'Health Check'],
    url: 'keys.avari.dev/dashboard'
  },
  {
    filename: '05-admin-nodes.png',
    badge: '⚙️ АДМИНИСТРИРОВАНИЕ • СЕРВЕРЫ И КАСКАДЫ',
    title: 'Управление нодами и динамическое переключение Egress',
    bullets: [
      'Централизованный контроль распределенных Slave API по токену X-API-Key',
      'Бесшовное переключение маршрута каскада (M0 → S1 / M0 → S4) без простоя',
      'Диагностика соединений, выгрузка резервных копий и перезапуск сервисов'
    ],
    tech: ['Dynamic Cascade', 'Slave Daemon', 'Diagnostics'],
    url: 'keys.avari.dev/admin/nodes'
  },
  {
    filename: '06-admin-users.png',
    badge: '👥 АДМИНИСТРИРОВАНИЕ • ПОЛЬЗОВАТЕЛИ',
    title: 'Модерация учетных записей, квоты и статус PRO',
    bullets: [
      'Очередь модерации: одобрение новых пользователей в 1 клик с уведомлением',
      'Назначение премиум-статуса PRO для доступа к изолированным нодам (S5P)',
      'Управление лимитами активных устройств и просмотр выданных ключей'
    ],
    tech: ['Moderation Flow', 'PRO Tier', 'Device Limits'],
    url: 'keys.avari.dev/admin/users'
  },
  {
    filename: '07-admin-audit-logs.png',
    badge: '📜 БЕЗОПАСНОСТЬ • ЖУРНАЛ АУДИТА',
    title: 'Неизменяемый аудит всех событий системы (Security Audit Log)',
    bullets: [
      'Фиксация авторизаций, выпуска и отзыва ключей с IP-адресами и временем',
      'Фильтрация по категориям (auth, keys, admin, nodes), пользователям и датам',
      'Экспорт журнала событий для внешнего анализа безопасности'
    ],
    tech: ['Audit Engine', 'IP Tracking', 'Event Filters'],
    url: 'keys.avari.dev/admin/logs'
  },
  {
    filename: '08-cooperative-billing.png',
    badge: '💳 БИЛЛИНГ • СОВМЕСТНОЕ СОДЕРЖАНИЕ',
    title: 'Кооперативный биллинг (Fair-Share Ledger)',
    bullets: [
      'Прозрачный расчет 30-дневного цикла серверов (взнос 300 ₽ + 50 ₽ PRO)',
      'Оплата по СБП / реквизитам с историей подтверждений и квитанциями',
      'Двусторонняя синхронизация с Telegram: кнопка «Оплатил» в боте'
    ],
    tech: ['Fair-Share Model', 'SBP Requisites', 'Telegram Sync'],
    url: 'keys.avari.dev/billing'
  }
];

function generateCardHtml(config, screenshotBase64) {
  const bulletItems = config.bullets
    .map(b => `<div class="bullet-item"><span class="bullet-dot"></span><span>${b}</span></div>`)
    .join('');

  const techPills = config.tech
    .map(t => `<span class="tech-pill">${t}</span>`)
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          width: 1600px;
          height: 1050px;
          background-color: #070B11;
          background-image: 
            radial-gradient(circle at 12% 8%, rgba(217, 185, 110, 0.13) 0%, transparent 42%),
            radial-gradient(circle at 88% 12%, rgba(56, 189, 248, 0.08) 0%, transparent 38%),
            radial-gradient(rgba(217, 185, 110, 0.14) 1px, transparent 1px);
          background-size: 100% 100%, 100% 100%, 28px 28px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #F8FAFC;
          display: flex;
          flex-direction: column;
          padding: 42px 56px 36px 56px;
          overflow: hidden;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 22px;
        }

        .header-left {
          max-width: 1060px;
        }

        .category-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          background: rgba(217, 185, 110, 0.12);
          border: 1px solid rgba(217, 185, 110, 0.35);
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #F0D48D;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          margin-bottom: 9px;
        }

        .title {
          font-size: 26px;
          font-weight: 800;
          color: #FFFFFF;
          letter-spacing: -0.02em;
          margin-bottom: 8px;
        }

        .bullets {
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
        }

        .bullet-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #94A3B8;
          font-weight: 500;
        }

        .bullet-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #D9B96E;
          box-shadow: 0 0 8px rgba(217, 185, 110, 0.8);
        }

        .header-right {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 4px;
        }

        .tech-pill {
          padding: 5px 11px;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          color: #CBD5E1;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }

        .window-frame {
          flex: 1;
          background: #0B1219;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          box-shadow: 
            0 25px 60px -15px rgba(0, 0, 0, 0.85),
            0 0 0 1px rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .window-titlebar {
          height: 38px;
          background: #0F1722;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          padding: 0 16px;
          position: relative;
        }

        .window-controls {
          display: flex;
          gap: 8px;
        }

        .control-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        .dot-red { background: #FF5F56; }
        .dot-yellow { background: #FFBD2E; }
        .dot-green { background: #27C93F; }

        .address-bar {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 3px 18px;
          border-radius: 6px;
          font-size: 12px;
          font-family: ui-monospace, SFMono-Regular, monospace;
          color: #94A3B8;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .address-bar svg {
          width: 11px;
          height: 11px;
          fill: #10B981;
        }

        .window-content {
          flex: 1;
          overflow: hidden;
          position: relative;
          background: #06141B;
        }

        .window-content img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
          display: block;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          <div class="category-pill">
            <span>${config.badge}</span>
          </div>
          <h1 class="title">${config.title}</h1>
          <div class="bullets">
            ${bulletItems}
          </div>
        </div>
        <div class="header-right">
          ${techPills}
        </div>
      </div>

      <div class="window-frame">
        <div class="window-titlebar">
          <div class="window-controls">
            <span class="control-dot dot-red"></span>
            <span class="control-dot dot-yellow"></span>
            <span class="control-dot dot-green"></span>
          </div>
          <div class="address-bar">
            <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
            <span>${config.url}</span>
          </div>
        </div>
        <div class="window-content">
          <img src="data:image/png;base64,${screenshotBase64}" alt="${config.title}" />
        </div>
      </div>
    </body>
    </html>
  `;
}

async function captureAndSaveCard(browser, appPage, cardConfig) {
  console.log(`Generating: ${cardConfig.filename} ...`);
  const appScreenshot = await appPage.screenshot({ encoding: 'base64' });

  const cardPage = await browser.newPage();
  await cardPage.setViewport({ width: 1600, height: 1050, deviceScaleFactor: 2 });
  const html = generateCardHtml(cardConfig, appScreenshot);
  await cardPage.setContent(html, { waitUntil: 'networkidle0' });

  const cardBuf = await cardPage.screenshot({ type: 'png' });
  const destPath = path.join(OUTPUT_DIR, cardConfig.filename);
  fs.writeFileSync(destPath, cardBuf);
  console.log(`Saved ${cardConfig.filename} (${Math.round(cardBuf.length / 1024)} KB)`);
  await cardPage.close();
}

async function main() {
  console.log('Starting Vite server...');
  const vite = spawn('npm', ['run', 'dev:mock', '--', '--port', String(PORT), '--strictPort'], {
    cwd: '.',
    shell: true,
    stdio: 'pipe'
  });

  await new Promise((resolve, reject) => {
    vite.stdout.on('data', (d) => {
      const s = d.toString();
      if (s.includes('ready in') || s.includes('Local:')) resolve();
    });
    vite.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('error')) console.error('Vite err:', s);
    });
    setTimeout(() => reject(new Error('Vite timeout')), 10000);
  });
  console.log('Vite server ready.');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--font-render-hinting=none']
  });

  const appPage = await browser.newPage();
  await appPage.setViewport({ width: 1360, height: 850, deviceScaleFactor: 2 });

  try {
    // 1. Login Screen
    console.log('--- Step 1: Login Screen ---');
    await appPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
    await appPage.evaluate(() => localStorage.clear());
    await appPage.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[0]);

    // 2. Dashboard Keys (as Alice)
    console.log('--- Step 2: Dashboard Keys (Alice) ---');
    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && el.textContent.includes('Клиент (Alice)'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1200));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[1]);

    // 3. Key Modal (Open first key modal)
    console.log('--- Step 3: Key Modal ---');
    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && (el.textContent.includes('QR & Конфиг') || el.textContent.includes('QR')));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1200));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[2]);

    // Close modal
    await appPage.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 600));

    // 4. Network Dashboard
    console.log('--- Step 4: Network Dashboard ---');
    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && el.textContent.includes('Статус сети'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1200));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[3]);

    // 5. Billing Page (Alice)
    console.log('--- Step 5: Cooperative Billing ---');
    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && el.textContent.includes('Биллинг'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1200));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[7]); // Card 8 config

    // 6. Switch to Forve (Admin)
    console.log('--- Step 6: Log in as Admin (Forve) ---');
    await appPage.evaluate(() => {
      localStorage.clear();
      location.href = '/';
    });
    await new Promise(r => setTimeout(r, 1200));

    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && el.textContent.includes('Админ (Forve)'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // 7. Admin Nodes
    console.log('--- Step 7: Admin Nodes ---');
    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && el.textContent.includes('Серверы'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[4]); // Card 5 config

    // 8. Admin Users
    console.log('--- Step 8: Admin Users ---');
    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && el.textContent.includes('Пользователи'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[5]); // Card 6 config

    // 9. Admin Logs
    console.log('--- Step 9: Admin Audit Logs ---');
    await appPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(el => el.textContent && (el.textContent.includes('Журнал аудита') || el.textContent.includes('Журнал')));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await captureAndSaveCard(browser, appPage, CARDS_CONFIG[6]); // Card 7 config

    console.log('All 8 showcase screenshots successfully generated!');
  } finally {
    await browser.close();
    vite.kill('SIGTERM');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
