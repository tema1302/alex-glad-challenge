// OG-карточка по file-convention app/opengraph-image.tsx → /opengraph-image (PNG
// 1200x630). Конвенция корневого сегмента автоматически вешает og:image на все
// страницы (в page.tsx/layout.tsx openGraph без images — не перекрывается).
//
// Кириллица: дефолтный шрифт next/og — Noto Sans latin-only, русский текст без
// кастомного шрифта превратится в tofu. Новые зависимости запрещены, fetch шрифта
// из сети на каждый запрос — точка хрупкости деплоя → вместо этого пробуем типовые
// СИСТЕМНЫЕ TTF с кириллицей (Segoe UI на Windows, DejaVu Sans на Linux). Не нашли —
// рендерим латинский fallback: OG-роут не должен 500-ить только потому, что на
// деплой-машине другой набор шрифтов.
import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'Артемия Артель — AI-инженер';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type FontEntry = { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' };

// Пары (regular, bold) системных шрифтов с кириллицей; порядок = приоритет.
const CYRILLIC_FONT_CANDIDATES: ReadonlyArray<{ regular: string; bold: string }> = [
  { regular: 'C:\\Windows\\Fonts\\segoeui.ttf', bold: 'C:\\Windows\\Fonts\\segoeuib.ttf' },
  {
    regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  },
];

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function readFont(path: string): Promise<ArrayBuffer | null> {
  try {
    return toArrayBuffer(await readFile(path));
  } catch {
    return null;
  }
}

// Мемоизация: 300КБ-1МБ TTF не читаем на каждый запрос краулера/мессенджера.
let fontsPromise: Promise<FontEntry[]> | null = null;

function loadCyrillicFonts(): Promise<FontEntry[]> {
  fontsPromise ??= (async () => {
    for (const candidate of CYRILLIC_FONT_CANDIDATES) {
      const regular = await readFont(candidate.regular);
      if (!regular) continue;
      const fonts: FontEntry[] = [{ name: 'Artel', data: regular, weight: 400, style: 'normal' }];
      const bold = await readFont(candidate.bold);
      if (bold) fonts.push({ name: 'Artel', data: bold, weight: 700, style: 'normal' });
      return fonts;
    }
    return [];
  })();
  return fontsPromise;
}

export default async function Image(): Promise<ImageResponse> {
  const fonts = await loadCyrillicFonts();
  const cyrillic = fonts.length > 0;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0F1417',
          padding: '64px 80px 72px',
          ...(fonts.length > 0 ? { fontFamily: 'Artel' } : {}),
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 26, color: '#5B6B78', letterSpacing: 8 }}>AI ENGINEERING</div>
          <div style={{ fontSize: 26, color: '#5B6B78', letterSpacing: 2 }}>
            t.me/artemiyartel
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              color: '#F2F5F7',
              letterSpacing: -2,
              lineHeight: 1.08,
            }}
          >
            {cyrillic ? 'Артемия Артель · AI-инженер' : 'ARTEMIY ARTEL — AI ENGINEER'}
          </div>
          <div style={{ fontSize: 36, color: '#93A1AD', lineHeight: 1.35, maxWidth: 960 }}>
            {cyrillic
              ? 'Строю AI-системы — и показываю, как они устроены внутри'
              : 'I build AI systems and show how they work inside'}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: 14,
            borderRadius: 7,
            background: 'linear-gradient(90deg, #5A4BFF 0%, #9333EA 50%, #14B8A6 100%)',
          }}
        />
      </div>
    ),
    { ...size, ...(fonts.length > 0 ? { fonts } : {}) },
  );
}
