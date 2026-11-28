import { test, expect } from '@playwright/test';

test.describe('Mobile-First VPN Key Creation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Login as demo user if on login page
    const userBtn = page.getByRole('button', { name: /Войти как Пользователь/i });
    if (await userBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userBtn.click();
    }
    await expect(
      page.getByRole('button', { name: /Подключить устройство|Создать ключ/i }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('opens modal, switches protocols, grays out incompatible servers and creates key', async ({ page }) => {
    // 1. Open Create Key Modal
    const createKeyBtn = page.getByRole('button', { name: /Создать ключ|Подключить устройство/i }).first();
    await createKeyBtn.click();

    await expect(page.getByRole('heading', { name: /Подключить устройство/i })).toBeVisible();

    // 2. Test Device Name Quick Chips
    const macChip = page.getByRole('button', { name: 'MacBook' });
    await expect(macChip).toBeVisible();
    await macChip.click();

    const deviceInput = page.locator('#device-name');
    await expect(deviceInput).toHaveValue('MacBook');

    // 3. AmneziaWG Protocol Default & PSK Visibility
    const awgCard = page.getByRole('button', { name: /^AmneziaWG/i });
    await expect(awgCard).toBeVisible();

    // Shadowrocket (PSK) option MUST be visible under AmneziaWG
    const pskOption = page.getByText(/Совместимость с Shadowrocket \(PSK\)/i);
    await expect(pskOption).toBeVisible();

    // 4. Switch Protocol to Hysteria 2
    const h2Card = page.getByRole('button', { name: /^Hysteria 2/i });
    await h2Card.click();

    // PSK option MUST be hidden under Hysteria 2
    await expect(pskOption).not.toBeVisible();

    // Incompatible servers (e.g. Node 1) must show badge "Нет Hysteria 2"
    const noH2Badge = page.getByText(/Нет Hysteria 2/i).first();
    await expect(noH2Badge).toBeVisible();

    // 5. Switch Protocol to VLESS+Reality
    const vlessCard = page.getByRole('button', { name: /^VLESS\+Reality/i });
    await vlessCard.click();

    // PSK option MUST still be hidden under VLESS
    await expect(pskOption).not.toBeVisible();

    // Cascade servers must show badge "Нет VLESS+Reality"
    const noVlessBadge = page.getByText(/Нет VLESS\+Reality/i).first();
    await expect(noVlessBadge).toBeVisible();

    // 6. Switch back to AmneziaWG
    await awgCard.click();
    await expect(pskOption).toBeVisible();

    // 7. Toggle PSK option
    const pskCheckbox = page.locator('#psk-toggle');
    await pskCheckbox.click();
    await expect(pskCheckbox).toBeChecked();

    // 8. Submit and verify key creation
    const submitBtn = page.getByRole('button', { name: /Создать профиль/i });
    await submitBtn.click();

    // Modal should close
    await expect(page.getByRole('heading', { name: /Подключить устройство/i })).not.toBeVisible({ timeout: 8000 });

    // New device name should appear in keys list or key detail modal
    await expect(page.getByRole('heading', { name: 'MacBook', exact: true }).first()).toBeVisible({ timeout: 8000 });
  });

  test('validates incompatible server clicking and error notifications', async ({ page }) => {
    // Open Create Key Modal
    const createKeyBtn = page.getByRole('button', { name: /Создать ключ|Подключить устройство/i }).first();
    await createKeyBtn.click();

    await expect(page.getByRole('heading', { name: /Подключить устройство/i })).toBeVisible();

    // Select Hysteria 2
    const h2Card = page.getByRole('button', { name: /^Hysteria 2/i });
    await h2Card.click();

    // Find first incompatible server card inside modal form and click it
    const node1Card = page.locator('form').getByText(/Каскад M0 \(Москва\) -> S1/i);
    await node1Card.click();

    // Error notification must be displayed explaining that node doesn't support Hysteria 2
    await expect(page.getByText(/не поддерживает протокол Hysteria 2/i)).toBeVisible();
  });
});
