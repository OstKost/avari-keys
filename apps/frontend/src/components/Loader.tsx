interface LoaderProps {
  size?: 'fullscreen' | 'section' | 'table' | 'mini';
  text?: string;
  colSpan?: number;
}

export function Loader({ size = 'section', text = 'Загрузка данных...', colSpan = 6 }: LoaderProps) {
  if (size === 'fullscreen') {
    return (
      <div className="min-h-screen bg-[#06141B] flex flex-col items-center justify-center p-4 selection:bg-[#D9B96E]/30 selection:text-[#F0D48D] z-50">
        <div className="relative mb-6 flex items-center justify-center">
          {/* Outer glowing pulse ring */}
          <div className="absolute w-24 h-24 rounded-full bg-[#D9B96E]/10 animate-ping opacity-75 pointer-events-none" />
          {/* Rotating gold spinner border */}
          <div className="w-20 h-20 rounded-full border-2 border-[#1C3945] border-t-[#D9B96E] border-r-[#F0D48D]/70 animate-spin" />
          {/* Center Logo Star */}
          <img
            src="/assets/logo_star.png"
            alt="Avari Star"
            className="absolute w-10 h-10 object-contain animate-pulse filter drop-shadow-[0_0_12px_rgba(217,185,110,0.6)]"
          />
        </div>
        <span className="font-serif tracking-widest uppercase text-sm sm:text-base text-gold-gradient font-bold animate-pulse">
          {text}
        </span>
        <span className="text-sm text-[#718187] font-mono tracking-wider mt-1.5 uppercase">
          Avari Keys • AmneziaWG
        </span>
      </div>
    );
  }

  if (size === 'table') {
    return (
      <tr>
        <td colSpan={colSpan} className="text-center py-16">
          <div className="flex flex-col items-center justify-center">
            <div className="relative mb-4 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full border-2 border-[#1C3945] border-t-[#D9B96E] border-r-[#F0D48D]/60 animate-spin" />
              <img
                src="/assets/logo_star.png"
                alt="Loading"
                className="absolute w-6 h-6 object-contain animate-pulse filter drop-shadow-[0_0_8px_rgba(217,185,110,0.5)]"
              />
            </div>
            <span className="text-sm font-mono tracking-widest uppercase text-[#D9B96E]">
              {text}
            </span>
          </div>
        </td>
      </tr>
    );
  }

  if (size === 'mini') {
    return (
      <div className="inline-flex items-center space-x-2">
        <div className="w-4 h-4 rounded-full border-2 border-[#1C3945] border-t-[#D9B96E] animate-spin" />
        {text && <span className="text-sm font-mono text-[#D9B96E]">{text}</span>}
      </div>
    );
  }

  // size === 'section'
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 min-h-[380px]">
      <div className="relative mb-4 flex items-center justify-center">
        {/* Outer subtle glow */}
        <div className="absolute w-16 h-16 rounded-full bg-[#D9B96E]/5 animate-ping opacity-50 pointer-events-none" />
        {/* Rotating ring */}
        <div className="w-14 h-14 rounded-full border-2 border-[#1C3945] border-t-[#D9B96E] border-r-[#F0D48D]/70 animate-spin" />
        {/* Pulsing Star Logo */}
        <img
          src="/assets/logo_star.png"
          alt="Avari Star"
          className="absolute w-7 h-7 object-contain animate-pulse filter drop-shadow-[0_0_10px_rgba(217,185,110,0.5)]"
        />
      </div>
      <span className="text-sm sm:text-base font-mono tracking-widest uppercase text-[#D9B96E] font-medium animate-pulse">
        {text}
      </span>
    </div>
  );
}
