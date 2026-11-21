export interface CountryInfo {
  code: string; // 3-letter uppercase (e.g. NLD, DEU, USA)
  flag: string; // Emoji flag (e.g. 🇳🇱, 🇩🇪, 🇺🇸)
  name: string; // Russian name (e.g. Нидерланды, Германия)
}

export const COUNTRIES: CountryInfo[] = [
  { code: 'NLD', flag: '🇳🇱', name: 'Нидерланды (Амстердам)' },
  { code: 'DEU', flag: '🇩🇪', name: 'Германия (Франкфурт)' },
  { code: 'FIN', flag: '🇫🇮', name: 'Финляндия (Хельсинки)' },
  { code: 'SWE', flag: '🇸🇪', name: 'Швеция (Стокгольм)' },
  { code: 'USA', flag: '🇺🇸', name: 'США (Америка)' },
  { code: 'GBR', flag: '🇬🇧', name: 'Великобритания (Лондон)' },
  { code: 'FRA', flag: '🇫🇷', name: 'Франция (Париж)' },
  { code: 'POL', flag: '🇵🇱', name: 'Польша (Варшава)' },
  { code: 'TUR', flag: '🇹🇷', name: 'Турция (Стамбул)' },
  { code: 'KAZ', flag: '🇰🇿', name: 'Казахстан (Алматы)' },
  { code: 'GEO', flag: '🇬🇪', name: 'Грузия (Тбилиси)' },
  { code: 'ARM', flag: '🇦🇲', name: 'Армения (Ереван)' },
  { code: 'SGP', flag: '🇸🇬', name: 'Сингапур' },
  { code: 'JPN', flag: '🇯🇵', name: 'Япония (Токио)' },
  { code: 'CHE', flag: '🇨🇭', name: 'Швейцария (Цюрих)' },
  { code: 'AUT', flag: '🇦🇹', name: 'Австрия (Вена)' },
  { code: 'EST', flag: '🇪🇪', name: 'Эстония (Таллин)' },
  { code: 'LVA', flag: '🇱🇻', name: 'Латвия (Рига)' },
  { code: 'LTU', flag: '🇱🇹', name: 'Литва (Вильнюс)' },
  { code: 'ESP', flag: '🇪🇸', name: 'Испания (Мадрид)' },
  { code: 'ITA', flag: '🇮🇹', name: 'Италия (Милан)' },
  { code: 'UAE', flag: '🇦🇪', name: 'ОАЭ (Дубай)' },
  { code: 'SRB', flag: '🇷🇸', name: 'Сербия (Белград)' },
  { code: 'CZE', flag: '🇨🇿', name: 'Чехия (Прага)' },
  { code: 'BGR', flag: '🇧🇬', name: 'Болгария (София)' },
  { code: 'ROU', flag: '🇷🇴', name: 'Румыния (Бухарест)' },
  { code: 'MDA', flag: '🇲🇩', name: 'Молдова (Кишинев)' },
  { code: 'UKR', flag: '🇺🇦', name: 'Украина (Киев)' },
  { code: 'ISR', flag: '🇮🇱', name: 'Израиль (Тель-Авив)' },
  { code: 'HKG', flag: '🇭🇰', name: 'Гонконг' },
  { code: 'NOR', flag: '🇳🇴', name: 'Норвегия (Осло)' },
  { code: 'ISL', flag: '🇮🇸', name: 'Исландия (Рейкьявик)' },
  { code: 'CAN', flag: '🇨🇦', name: 'Канада (Торонто)' },
  { code: 'RUS', flag: '🇷🇺', name: 'Россия (Москва)' },
];

const COUNTRY_MAP: Record<string, CountryInfo> = COUNTRIES.reduce((acc, c) => {
  acc[c.code.toUpperCase()] = c;
  return acc;
}, {} as Record<string, CountryInfo>);

/**
 * Returns country info for a given 2/3-letter code or fallback.
 */
export function getCountryInfo(code?: string): CountryInfo | null {
  if (!code) return null;
  const clean = code.trim().toUpperCase();
  if (COUNTRY_MAP[clean]) {
    return COUNTRY_MAP[clean];
  }
  // Fallback for custom 3-letter codes
  return {
    code: clean,
    flag: '🌐',
    name: clean,
  };
}

/**
 * Returns emoji flag for a given country code.
 */
export function getCountryFlag(code?: string): string {
  return getCountryInfo(code)?.flag || '🌐';
}

/**
 * Returns localized country name for a given country code.
 */
export function formatCountry(code?: string): string {
  return getCountryInfo(code)?.name || code || 'Зарубежный';
}

/**
 * Formats routing representation for a server:
 * - Cascade: "🇷🇺 RUS ➔ 🇳🇱 NLD"
 * - Direct: "🇳🇱 NLD"
 */
export function formatNodeRouting(type: 'cascade' | 'direct', countryCode?: string): {
  prefix?: string;
  arrow?: string;
  targetFlag: string;
  targetCode: string;
  fullText: string;
} {
  const target = getCountryInfo(countryCode) || {
    code: type === 'cascade' ? 'EXT' : 'DIR',
    flag: '🌐',
    name: 'Зарубежный узел',
  };

  if (type === 'cascade') {
    return {
      prefix: '🇷🇺 RUS',
      arrow: '➔',
      targetFlag: target.flag,
      targetCode: target.code,
      fullText: `🇷🇺 RUS ➔ ${target.flag} ${target.code}`,
    };
  }

  return {
    targetFlag: target.flag,
    targetCode: target.code,
    fullText: `${target.flag} ${target.code}`,
  };
}
