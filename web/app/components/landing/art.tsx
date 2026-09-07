// Сгенерированные SVG-иллюстрации лендинга «Paper × Aurora» (v3).
// Единый визуальный язык: aurora-градиент (#5A4BFF → #9333EA → #14B8A6),
// стеклянные белые формы, hairline #E6E2D8, mono-подписи. Все — server-safe
// inline-SVG (0 JS, 0 deps), aria-hidden. Уникальные id-префиксы градиентов
// на компонент (без коллизий при нескольких инстансах на странице).
import type { SVGProps } from 'react';

type ArtProps = { className?: string };

const MONO = 'var(--font-mono), ui-monospace, monospace';
const SANS = 'var(--font-sans), system-ui, sans-serif';

/* ─────────────────────────── Hero ─────────────────────────── */

/** Центральная композиция hero: aurora-ядро, орбиты, стеклянные чипы систем. */
export function HeroArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 560 560" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="ha-aurora" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="0.5" stopColor="#9333EA" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
        <radialGradient id="ha-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#6C5CFF" stopOpacity="0.3" />
          <stop offset="1" stopColor="#6C5CFF" stopOpacity="0" />
        </radialGradient>
        <pattern id="ha-dots" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.5" fill="#0C1116" opacity="0.06" />
        </pattern>
      </defs>

      <rect x="30" y="30" width="500" height="500" rx="28" fill="url(#ha-dots)" />

      {/* орбиты */}
      <circle cx="280" cy="280" r="120" stroke="#C9C2FF" strokeWidth="1.5" strokeDasharray="3 8" />
      <circle cx="280" cy="280" r="175" stroke="#E6E2D8" strokeWidth="1.5" />
      <circle cx="280" cy="280" r="232" stroke="#E6E2D8" strokeWidth="1.5" strokeDasharray="1 7" />
      <path d="M 280 105 A 175 175 0 0 1 452 245" stroke="url(#ha-aurora)" strokeWidth="3" strokeLinecap="round" />

      {/* ядро */}
      <circle cx="280" cy="280" r="150" fill="url(#ha-glow)" />
      <circle cx="280" cy="280" r="64" fill="url(#ha-aurora)" />
      <circle cx="280" cy="280" r="64" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="2" />
      <ellipse cx="259" cy="259" rx="24" ry="12" fill="#FFFFFF" opacity="0.4" transform="rotate(-30 259 259)" />
      <text x="280" y="277" textAnchor="middle" fontSize="13" fontWeight="700" fill="#FFFFFF" fontFamily={SANS}>
        AI-стэк
      </text>
      <text x="280" y="295" textAnchor="middle" fontSize="9.5" fill="#FFFFFF" opacity="0.85" fontFamily={MONO}>
        1 repo · 6 систем
      </text>

      {/* коннекторы */}
      <g stroke="#A99EFF" strokeWidth="1.5" strokeDasharray="2 5">
        <line x1="280" y1="216" x2="280" y2="128" />
        <line x1="341" y1="317" x2="400" y2="352" />
        <line x1="219" y1="317" x2="160" y2="352" />
        <line x1="332" y1="230" x2="392" y2="190" />
      </g>

      {/* чипы систем (стекло) */}
      <Chip x={216} y={88} label="RAG-поиск" />
      <Chip x={386} y={172} label="MCP-серверы" />
      <Chip x={96} y={352} label="TG-юзербот" />
      <Chip x={348} y={352} label="Память" accent />

      {/* искры */}
      <g stroke="#9333EA" strokeWidth="2" strokeLinecap="round" opacity="0.5">
        <path d="M84 120v16M76 128h16" />
        <path d="M482 96v12M476 102h12" />
        <path d="M478 462v12M472 468h12" />
      </g>
    </svg>
  );
}

function Chip({ x, y, label, accent = false }: { x: number; y: number; label: string; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width="128" height="40" rx="20" fill="#FFFFFF" stroke="#E6E2D8" />
      <rect x={x} y={y} width="128" height="40" rx="20" fill="none" stroke="#FFFFFF" strokeOpacity="0" />
      <circle cx={x + 20} cy={y + 20} r="5" fill={accent ? '#14B8A6' : '#5A4BFF'} />
      <text x={x + 34} y={y + 24.5} fontSize="11.5" fontWeight="600" fill="#0C1116" fontFamily={SANS}>
        {label}
      </text>
    </g>
  );
}

/* ─────────────────── Арты инструментов (320×200) ─────────────────── */

/** RAG: документы + векторное созвездие + линза. */
export function ArtRag({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="ar-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#9333EA" />
        </linearGradient>
      </defs>
      {/* стопка документов */}
      <g>
        <rect x="24" y="52" width="84" height="112" rx="10" fill="#F1EFFF" stroke="#C9C2FF" />
        <rect x="36" y="44" width="84" height="112" rx="10" fill="#FFFFFF" stroke="#E6E2D8" />
        <rect x="48" y="36" width="84" height="112" rx="10" fill="#FFFFFF" stroke="#E6E2D8" />
        <g stroke="#D7D2E8" strokeWidth="5" strokeLinecap="round">
          <line x1="60" y1="58" x2="118" y2="58" />
          <line x1="60" y1="74" x2="112" y2="74" />
          <line x1="60" y1="90" x2="120" y2="90" />
          <line x1="60" y1="106" x2="104" y2="106" />
        </g>
        <rect x="60" y="122" width="42" height="14" rx="7" fill="#E4E0FF" />
      </g>
      {/* векторное созвездие */}
      <g stroke="#C9C2FF" strokeWidth="1.5" strokeDasharray="3 5">
        <path d="M196 64 L232 44 L268 72 L222 104 L262 136 L196 118 Z" />
      </g>
      <g>
        <circle cx="196" cy="64" r="6" fill="#5A4BFF" />
        <circle cx="232" cy="44" r="5" fill="#14B8A6" />
        <circle cx="268" cy="72" r="6" fill="#9333EA" />
        <circle cx="222" cy="104" r="7" fill="#5A4BFF" />
        <circle cx="262" cy="136" r="5" fill="#14B8A6" />
        <circle cx="196" cy="118" r="6" fill="#9333EA" />
      </g>
      {/* линза поиска */}
      <circle cx="206" cy="112" r="27" fill="#FFFFFF" fillOpacity="0.75" stroke="#5A4BFF" strokeWidth="3.5" />
      <line x1="226" y1="132" x2="246" y2="152" stroke="#5A4BFF" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

/** MCP: hub-узел с tool-сателлитами. */
export function ArtMcp({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="am-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
      </defs>
      <g stroke="#C9C2FF" strokeWidth="1.5">
        <line x1="160" y1="100" x2="62" y2="48" />
        <line x1="160" y1="100" x2="62" y2="152" />
        <line x1="160" y1="100" x2="160" y2="34" />
        <line x1="160" y1="100" x2="258" y2="58" />
        <line x1="160" y1="100" x2="258" y2="146" />
      </g>
      <rect x="138" y="78" width="44" height="44" rx="14" fill="url(#am-g)" />
      <circle cx="160" cy="100" r="8" fill="#FFFFFF" opacity="0.9" />
      <g>
        <circle cx="62" cy="48" r="11" fill="#FFFFFF" stroke="#E6E2D8" strokeWidth="1.5" />
        <circle cx="62" cy="152" r="11" fill="#FFFFFF" stroke="#E6E2D8" strokeWidth="1.5" />
        <circle cx="160" cy="34" r="11" fill="#FFFFFF" stroke="#E6E2D8" strokeWidth="1.5" />
        <circle cx="258" cy="146" r="11" fill="#FFFFFF" stroke="#E6E2D8" strokeWidth="1.5" />
        <circle cx="258" cy="58" r="14" fill="#5A4BFF" />
        <circle cx="258" cy="58" r="21" stroke="#5A4BFF" strokeOpacity="0.3" strokeWidth="2" />
      </g>
      <text x="288" y="176" fontSize="10" fill="#575F67" fontFamily={MONO} textAnchor="end">
        7 tools
      </text>
    </svg>
  );
}

/** Telegram: пузыри + самолёт + typing. */
export function ArtTg({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="at-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
      </defs>
      <rect x="30" y="34" width="152" height="58" rx="18" fill="#FFFFFF" stroke="#E6E2D8" />
      <g stroke="#D7D2E8" strokeWidth="6" strokeLinecap="round">
        <line x1="48" y1="54" x2="150" y2="54" />
        <line x1="48" y1="72" x2="118" y2="72" />
      </g>
      <path d="M50 92 l14 12 -2 -14 Z" fill="#FFFFFF" stroke="#E6E2D8" />
      <rect x="136" y="108" width="154" height="58" rx="18" fill="url(#at-g)" />
      <g stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" opacity="0.9">
        <line x1="154" y1="128" x2="262" y2="128" />
        <line x1="154" y1="146" x2="226" y2="146" />
      </g>
      <path d="M272 166 l-14 -12 2 14 Z" fill="#5A4BFF" />
      {/* typing */}
      <g fill="#9333EA">
        <circle cx="292" cy="60" r="4.5" />
        <circle cx="302" cy="60" r="4.5" opacity="0.6" />
        <circle cx="312" cy="60" r="4.5" opacity="0.3" />
      </g>
      {/* самолёт */}
      <path d="M242 24 L292 44 L258 52 L250 72 L238 50 Z" fill="#14B8A6" />
      <path d="M258 52 L292 44" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Память: три слоя. */
export function ArtMemory({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="amy-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#9333EA" />
        </linearGradient>
      </defs>
      <g fontFamily={MONO} fontSize="11" fill="#575F67">
        <text x="24" y="58">working</text>
        <text x="24" y="112">task</text>
        <text x="24" y="166">long-term</text>
      </g>
      <g>
        <rect x="104" y="36" width="192" height="30" rx="15" fill="#F1EFFF" stroke="#C9C2FF" />
        <rect x="104" y="90" width="192" height="30" rx="15" fill="#FFFFFF" stroke="#E6E2D8" />
        <rect x="104" y="144" width="192" height="30" rx="15" fill="url(#amy-g)" />
      </g>
      <g stroke="#A99EFF" strokeWidth="1.5" strokeDasharray="2 6">
        <line x1="200" y1="66" x2="200" y2="90" />
        <line x1="200" y1="120" x2="200" y2="144" />
      </g>
      <g fill="#FFFFFF" opacity="0.95">
        <circle cx="128" cy="51" r="5" />
        <circle cx="128" cy="105" r="5" fill="#5A4BFF" />
        <circle cx="128" cy="159" r="5" />
      </g>
    </svg>
  );
}

/** Gateway: три провайдера → один вход. */
export function ArtGateway({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="ag-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#9333EA" />
        </linearGradient>
      </defs>
      <g fontFamily={SANS} fontSize="11.5" fontWeight="600" fill="#0C1116">
        <rect x="16" y="38" width="104" height="30" rx="15" fill="#FFFFFF" stroke="#E6E2D8" />
        <text x="68" y="57" textAnchor="middle">Ollama</text>
        <rect x="16" y="86" width="104" height="30" rx="15" fill="#FFFFFF" stroke="#E6E2D8" />
        <text x="68" y="105" textAnchor="middle">DeepSeek</text>
        <rect x="16" y="134" width="104" height="30" rx="15" fill="#FFFFFF" stroke="#E6E2D8" />
        <text x="68" y="153" textAnchor="middle">OpenRouter</text>
      </g>
      <g stroke="url(#ag-g)" strokeWidth="2" fill="none">
        <path d="M120 53 C 156 53, 152 96, 182 98" />
        <path d="M120 101 L 182 101" />
        <path d="M120 149 C 156 149, 152 106, 182 104" />
      </g>
      <circle cx="204" cy="101" r="24" fill="#5A4BFF" />
      <circle cx="204" cy="101" r="24" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="2" />
      <text x="204" y="106" fontSize="12" fontWeight="700" fill="#FFFFFF" textAnchor="middle" fontFamily={SANS}>
        GW
      </text>
      <g stroke="#C9C2FF" strokeWidth="2">
        <line x1="228" y1="101" x2="266" y2="101" />
      </g>
      <path d="M266 101 l-8 -5 v10 Z" fill="#C9C2FF" transform="rotate(180 262 101)" />
      <rect x="270" y="86" width="36" height="30" rx="15" fill="#14B8A6" />
      <text x="288" y="105" fontSize="11" fontWeight="700" fill="#FFFFFF" textAnchor="middle" fontFamily={SANS}>
        app
      </text>
    </svg>
  );
}

/** Web-дашборд: мини-мокап окна с графиками. */
export function ArtDash({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="ad-g" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#9333EA" />
        </linearGradient>
      </defs>
      <rect x="26" y="28" width="268" height="150" rx="14" fill="#FFFFFF" stroke="#E6E2D8" />
      <line x1="26" y1="54" x2="294" y2="54" stroke="#E6E2D8" />
      <circle cx="44" cy="41" r="4" fill="#E05656" opacity="0.7" />
      <circle cx="58" cy="41" r="4" fill="#E0A23C" opacity="0.7" />
      <circle cx="72" cy="41" r="4" fill="#14B8A6" />
      {/* бары */}
      <g fill="url(#ad-g)">
        <rect x="52" y="112" width="18" height="44" rx="4" opacity="0.55" />
        <rect x="76" y="96" width="18" height="60" rx="4" opacity="0.7" />
        <rect x="100" y="120" width="18" height="36" rx="4" opacity="0.5" />
        <rect x="124" y="84" width="18" height="72" rx="4" opacity="0.85" />
        <rect x="148" y="100" width="18" height="56" rx="4" />
      </g>
      <line x1="46" y1="157" x2="172" y2="157" stroke="#E6E2D8" strokeWidth="2" />
      {/* донат */}
      <circle cx="230" cy="108" r="30" stroke="#E6E2D8" strokeWidth="11" fill="none" />
      <circle
        cx="230"
        cy="108"
        r="30"
        stroke="url(#ad-g)"
        strokeWidth="11"
        fill="none"
        strokeDasharray="132 189"
        strokeLinecap="round"
        transform="rotate(-90 230 108)"
      />
      <text x="230" y="113" fontSize="13" fontWeight="700" fill="#0C1116" textAnchor="middle" fontFamily={MONO}>
        99k
      </text>
    </svg>
  );
}

/** Пайплайн агентов: 4 стадии. */
export function ArtPipeline({ className }: ArtProps) {
  const stages = [
    { label: 'scout', hot: true },
    { label: 'draft', hot: false },
    { label: 'fact', hot: false },
    { label: 'edit', hot: false },
  ];
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="ap-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
      </defs>
      <rect x="30" y="42" width="260" height="4" rx="2" stroke="#E6E2D8" strokeWidth="2" fill="#FFFFFF" />
      <rect x="30" y="42" width="130" height="4" rx="2" fill="url(#ap-g)" />
      {stages.map((s, i) => {
        const x = 16 + i * 74;
        const hot = s.hot;
        return (
          <g key={s.label}>
            <rect
              x={x}
              y={78}
              width="66"
              height="34"
              rx="17"
              fill={hot ? 'url(#ap-g)' : '#FFFFFF'}
              stroke={hot ? 'none' : '#E6E2D8'}
            />
            <text
              x={x + 33}
              y={99.5}
              fontSize="11.5"
              fontWeight="600"
              fill={hot ? '#FFFFFF' : '#575F67'}
              textAnchor="middle"
              fontFamily={MONO}
            >
              {s.label}
            </text>
            {i < 3 && (
              <path d={`M${x + 70} 95 h10 m-4 -4 l4 4 -4 4`} stroke="#A99EFF" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            )}
          </g>
        );
      })}
      <g fontFamily={MONO} fontSize="10" fill="#575F67">
        <text x="30" y="146">выбор темы → черновик → фактчекинг → правка</text>
        <text x="30" y="162" fill="#14B8A6">реальная отправка — только после confirm</text>
      </g>
    </svg>
  );
}

/** Jira-генератор: карточка задачи + критерии приёмки. */
export function ArtJira({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className} {...SVG_RESET}>
      <defs>
        <linearGradient id="aj-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5A4BFF" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
      </defs>
      {/* тикет */}
      <rect x="30" y="36" width="150" height="128" rx="14" fill="#FFFFFF" stroke="#E6E2D8" />
      <rect x="48" y="54" width="64" height="16" rx="8" fill="#E4E0FF" />
      <g stroke="#D7D2E8" strokeWidth="5" strokeLinecap="round">
        <line x1="48" y1="88" x2="160" y2="88" />
        <line x1="48" y1="104" x2="150" y2="104" />
        <line x1="48" y1="120" x2="156" y2="120" />
        <line x1="48" y1="136" x2="128" y2="136" />
      </g>
      {/* галка приёмки */}
      <circle cx="238" cy="100" r="40" fill="url(#aj-g)" />
      <circle cx="238" cy="100" r="40" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth="2" />
      <path d="M220 101 l12 12 24 -26" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <g stroke="#9333EA" strokeWidth="2" strokeLinecap="round" opacity="0.5">
        <path d="M290 40v12M284 46h12" />
        <path d="M196 168v10M191 173h10" />
      </g>
    </svg>
  );
}

const SVG_RESET: SVGProps<SVGSVGElement> = {
  width: '100%',
  height: 'auto',
};
