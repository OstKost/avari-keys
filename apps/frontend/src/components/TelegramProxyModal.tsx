import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Copy, Check, ExternalLink, ShieldCheck, Globe, Wifi } from 'lucide-react';
import QRCode from 'qrcode';
import { TelegramProxyInfo } from '../types';
import { useToast } from '../context/ToastContext';

interface Props {
  proxies: TelegramProxyInfo[];
  onClose: () => void;
}

export function TelegramProxyModal({ proxies, onClose }: Props) {
  const { toast } = useToast();
  const safeProxies = Array.isArray(proxies) ? proxies : [];
  const [selectedId, setSelectedId] = useState<string>(safeProxies[0]?.id || '');
  const [copied, setCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState<string>('');

  const currentProxy = safeProxies.find((p) => p.id === selectedId) || safeProxies[0];

  useEffect(() => {
    if (currentProxy?.link) {
      QRCode.toDataURL(currentProxy.link, {
        width: 320,
        margin: 2,
        color: { dark: '#06141B', light: '#FFFFFF' },
      })
        .then(setQrUrl)
        .catch(console.error);
    }
  }, [currentProxy]);

  const handleCopyLink = () => {
    if (!currentProxy) return;
    navigator.clipboard.writeText(currentProxy.link);
    setCopied(true);
    toast.success('Ссылка на прокси Telegram скопирована');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenTelegram = () => {
    if (!currentProxy) return;
    window.open(currentProxy.link, '_blank');
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-[#06141B]/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-[#0A1D26]/95 backdrop-blur-xl border border-[#1C3945] hover:border-[#D9B96E]/50 rounded-3xl max-w-lg md:max-w-2xl w-full p-4 sm:p-6 sm:p-8 shadow-2xl shadow-black/90 relative my-auto transition-all duration-300">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 text-[#A8B4B7] hover:text-[#F2F0E8] p-2 rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition cursor-pointer"
          title="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-3 sm:space-x-3.5 mb-5 sm:mb-6 pr-8">
          <div className="bg-[#102833] p-2.5 sm:p-3.5 rounded-2xl text-[#2AABEE] border border-[#1C3945] shrink-0">
            <Send className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h3 className="font-serif text-xl sm:text-2xl font-bold text-[#F2F0E8] tracking-wide">
              Telegram MTProxy
            </h3>
            <p className="text-xs sm:text-sm text-[#A8B4B7] mt-0.5 font-sans">
              Быстрый обход блокировок Telegram без отдельного VPN-приложения
            </p>
          </div>
        </div>

        {/* Server Selection (if multiple) */}
        {safeProxies.length > 1 && (
          <div className="mb-5">
            <label className="block text-xs font-mono font-semibold text-[#D9B96E] uppercase tracking-wider mb-2">
              Выберите сервер прокси
            </label>
            <div className="grid grid-cols-2 gap-2">
              {safeProxies.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    p.id === currentProxy?.id
                      ? 'border-[#D9B96E] bg-[#102833] shadow-md shadow-[#D9B96E]/10'
                      : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Globe className="w-4 h-4 text-[#D9B96E]" />
                    <span className="font-serif font-bold text-sm text-[#F2F0E8]">{p.name}</span>
                  </div>
                  <div className="text-xs text-[#A8B4B7] mt-1 font-mono">
                    {p.server}:{p.port}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Proxy Details and QR Display */}
        {currentProxy ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch mb-6">
            {/* QR Code Column */}
            <div className="md:col-span-5 flex flex-col items-center justify-center bg-white p-5 rounded-2xl shadow-xl border-4 border-[#102833] min-h-[220px]">
              {qrUrl ? (
                <>
                  <img src={qrUrl} alt="Telegram Proxy QR" className="w-44 h-44 sm:w-48 sm:h-48 object-contain rounded-lg" />
                  <span className="text-[11px] sm:text-xs text-slate-800 font-mono tracking-wider font-semibold mt-2.5 text-center">
                    Наведите камеру смартфона
                  </span>
                </>
              ) : (
                <div className="flex items-center justify-center h-44 text-[#718187] text-xs font-mono">
                  Генерация QR-кода...
                </div>
              )}
            </div>

            {/* Parameters and Action Buttons Column */}
            <div className="md:col-span-7 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="bg-[#06141B] border border-[#1C3945] rounded-2xl p-3.5 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#A8B4B7] font-sans">Сервер:</span>
                    <span className="font-mono font-semibold text-[#F2F0E8]">{currentProxy.server}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#A8B4B7] font-sans">Порт:</span>
                    <span className="font-mono font-semibold text-[#D9B96E]">{currentProxy.port}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#A8B4B7] font-sans">Локация:</span>
                    <span className="font-mono font-semibold text-[#6EA8C4]">{currentProxy.name}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#A8B4B7] font-sans">Статус:</span>
                    <span className="inline-flex items-center space-x-1 font-mono text-emerald-400">
                      <Wifi className="w-3 h-3" />
                      <span>Онлайн (Active)</span>
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-[#0D222C] border border-[#1C3945] rounded-xl text-xs text-[#A8B4B7] font-sans leading-relaxed">
                  <ShieldCheck className="w-4 h-4 text-[#D9B96E] inline mr-1.5" />
                  Работает поверх Fake-TLS. Трафик Telegram замаскирован под HTTPS-соединение к домену <strong>{currentProxy.server}</strong>.
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center justify-center space-x-2 bg-[#102833] text-[#F2F0E8] font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl border border-[#1C3945] hover:bg-[#1C3945] hover:border-[#D9B96E]/50 transition cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#D9B96E]" />}
                  <span>{copied ? 'Скопировано!' : 'Скопировать ссылку'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenTelegram}
                  className="flex items-center justify-center space-x-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white font-bold font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl shadow-lg shadow-[#2AABEE]/25 transition cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Открыть в Telegram</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[#A8B4B7] font-sans">
            Список серверов временно недоступен.
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
