import { AIProvider } from '@/stores/useSettingsStore';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  apiUrl?: string;
}

export function getBuiltinAIConfig(provider: 'deepseek' | 'openrouter'): AIConfig | null {
  if (provider === 'deepseek') {
    const apiKey = process.env.NEXT_PUBLIC_DEEPSEEK_KEY || '';
    if (!apiKey) return null;
    return { provider: 'deepseek', apiKey, model: 'deepseek-chat' };
  }
  const apiKey = process.env.NEXT_PUBLIC_OPENROUTER_KEY || '';
  if (!apiKey) return null;
  return {
    provider: 'openrouter',
    apiKey,
    model: process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
  };
}

export function hasBuiltinProvider(provider: 'deepseek' | 'openrouter'): boolean {
  return !!getBuiltinAIConfig(provider);
}

interface AIGeneratedQuestion {
  text: string;
  options: Array<{ id: string; text: string; isCorrect: boolean }>;
  explanation: string;
  imagePrompt?: string;
}

interface RawAIQuestion {
  text?: unknown;
  options?: unknown;
  explanation?: unknown;
  imagePrompt?: unknown;
}

interface RawAIOption {
  id?: unknown;
  text?: unknown;
  isCorrect?: unknown;
}

interface RawAIModule {
  title?: unknown;
  description?: unknown;
  lessons?: RawAILesson[];
  milestoneExam?: RawAIQuestion[];
}

interface RawAILesson {
  title?: unknown;
  content?: unknown;
  questions?: RawAIQuestion[];
}

function validateAIQuestions(data: unknown): AIGeneratedQuestion[] {
  if (!Array.isArray(data)) throw new Error('AI response is not an array');

  return data.map((item: unknown, i: number) => {
    if (!item || typeof item !== 'object') throw new Error(`Question ${i}: not an object`);
    const q = item as RawAIQuestion;
    if (typeof q.text !== 'string') throw new Error(`Question ${i}: missing text`);
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Question ${i}: options must be array with 2+ items`);
    }
    if (typeof q.explanation !== 'string') throw new Error(`Question ${i}: missing explanation`);

    return {
      text: q.text,
      options: (q.options as RawAIOption[]).map((o) => ({
        id: String(o.id || `o${Math.random().toString(36).slice(2, 6)}`),
        text: String(o.text || ''),
        isCorrect: Boolean(o.isCorrect),
      })),
      explanation: q.explanation,
      imagePrompt: typeof q.imagePrompt === 'string' ? q.imagePrompt : undefined,
    };
  });
}

export function getApiUrl(provider: AIProvider): string {
  switch (provider) {
    case 'deepseek':
      return 'https://api.deepseek.com/v1/chat/completions';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/chat/completions';
    default:
      return '';
  }
}

export function getModel(config: AIConfig): string {
  if (config.provider === 'deepseek') return 'deepseek-chat';
  if (config.provider === 'openrouter') return config.model || 'google/gemini-2.0-flash-001';
  return config.model || '';
}

export function getHeaders(config: AIConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : '';
    headers['X-Title'] = 'LMS App';
  }
  return headers;
}

const PEDAGOGY_RULES = `
СТИЛЬ ВОПРОСОВ И ОБЪЯСНЕНИЙ:

1. ВОПРОСЫ — формулируй через жизненные ситуации, аналогии и конкретные примеры.
   Плохо: "Какой тип данных используется для хранения целых чисел?"
   Хорошо: "Ты сохраняешь количество заказов в переменную. Какой тип данных не потеряет дробную часть, если заказов станет 2.5?"

2. ВАРИАНТЫ ОТВЕТОВ — делай их конкретными и запоминающимися. Используй образы, а не сухие термины.
   Плохо: "String", "Number", "Boolean", "Array"
   Хорошо: "Текст-бирка (String)", "Счётчик (Number)", "Переключатель вкл/выкл (Boolean)", "Шкаф с ящиками (Array)"

3. НЕВЕРНЫЕ ВАРИАНТЫ — каждый должен быть правдоподобным. Это не случайный шум, а типичная ошибка новичка.
   Человек, который выберет неверный вариант, должен из объяснения понять, почему ошибся.

4. ОБЪЯСНЕНИЕ (explanation) — пиши так, чтобы понял и школьник, и senior-разработчик:
   - Начни с простой аналогии из реальной жизни (1-2 предложения)
   - Затем — точное объяснение сути (1-2 предложения)
   - Заверши короткой формулой-правилом: "Запомни: ..."
   Плохо: "Потому что JavaScript использует строгую типизацию."
   Хорошо: "Представь камеру хранения на вокзале — каждая ячейка принимает только свой размер. JavaScript наоборот: переменная — это пустая коробка, в неё можно положить что угодно. Запомни: в JS тип привязан к значению, а не к переменной."

5. ЯЗЫК — русский. Технические термины давай с английским оригиналом в скобках: "замыкание (closure)".

6. ВИЗУАЛЬНЫЕ ЯКОРЯ — для КАЖДОГО вопроса:
   - "emoji": один emoji, который мгновенно ассоциируется с сутью вопроса. Например: 🔒 для безопасности, 🌊 для потока данных, 📦 для переменной. Не используй ❓ и банальные emoji.
   - "imagePrompt": описание картинки для генерации, 5-10 слов на английском. Должно быть конкретным, ярким, метафоричным. Например: "a locked safe with glowing key hovering above it, dark background". НЕ пиши текст на картинке.
`;

export function buildImageUrl(prompt: string, width = 400, height = 250): string {
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true&seed=42`;
}

export async function generateImagePrompt(config: AIConfig, question: { text: string; explanation: string; options: Array<{ text: string; isCorrect: boolean }> }): Promise<string> {
  const correctOption = question.options.find((o: { isCorrect: boolean }) => o.isCorrect);
  const res = await fetch(
    config.provider === 'custom' ? (config.apiUrl || '') : getApiUrl(config.provider),
    {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        model: getModel(config),
        messages: [
          { role: 'system', content: 'Describe a vivid visual scene that illustrates the following educational concept. Return ONLY the description in 5-10 words in English. Be metaphorical, striking, memorable. Example: "a locked safe with glowing key hovering above it, dark background". Do NOT include any text or labels in the scene.' },
          { role: 'user', content: `Question: ${question.text}\nCorrect answer: ${correctOption?.text ?? ''}\nExplanation: ${question.explanation}` },
        ],
        temperature: 0.8,
        max_tokens: 100,
      }),
    },
  );
  if (!res.ok) throw new Error(`AI Error ${res.status}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

const SYSTEM_PROMPT = `Ты — генератор образовательных тестов. На основе предоставленного обучающего текста ты должен сгенерировать массив вопросов в формате JSON.

ТРЕБОВАНИЯ К ФОРМАТУ ОТВЕТА:
- Возвращай ТОЛЬКО валидный JSON-массив, без markdown, без пояснений.
- Каждый элемент массива — объект с полями:
  - "text": строка — текст вопроса
  - "options": массив из 4 объектов { "id": "o1"|"o2"|"o3"|"o4", "text": строка, "isCorrect": boolean }
  - "explanation": строка — объяснение правильного ответа
  - "imagePrompt": строка — описание картинки на английском, 5-10 слов
  - Ровно один вариант должен иметь isCorrect: true

ПРАВИЛА:
- Генерируй 10-20 вопросов по ключевым фактам текста
- Вопросы должны проверять ПОНИМАНИЕ, а не зазубривание
- Неправильные варианты должны быть типичными ошибками, а не случайной чепухой
- imagePrompt ОБЯЗАТЕЛЕН для каждого вопроса

${PEDAGOGY_RULES}`;

async function callAI(config: AIConfig, systemPrompt: string, userContent: string): Promise<string> {
  const url = config.provider === 'custom' ? (config.apiUrl || '') : getApiUrl(config.provider);
  const model = getModel(config);

  if (!url) throw new Error('API URL is not configured');
  if (!config.apiKey) throw new Error('API key is not configured');

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_tokens: 16384,
    }),
  });

  if (!response.ok) throw new Error(`${config.provider} API Error: ${response.status}`);

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');

  return content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export async function generateQuestionsFromText(
  rawText: string,
  config: AIConfig
): Promise<AIGeneratedQuestion[]> {
  const cleaned = await callAI(config, SYSTEM_PROMPT, rawText);
  return validateAIQuestions(JSON.parse(cleaned));
}

const MODULE_SYSTEM_PROMPT = `Ты — эксперт в создании образовательного контента.
Твоя задача — проанализировать предоставленный текст и разбить его на один или несколько логических МОДУЛЕЙ.
Каждый модуль должен содержать уроки с теорией и тестами.

ВАЖНО: Если текст очень большой и ответ получается объёмным — разбей его на несколько модулей так, чтобы каждый модуль можно было генерировать отдельно. Слона нужно есть по частям!

ФОРМАТ ОТВЕТА (строго массив JSON):
[
  {
    "title": "Название модуля",
    "description": "Краткое описание модуля",
    "lessons": [
      {
        "title": "Название урока",
        "content": "Содержание урока в формате Markdown. Пиши живым языком с примерами и аналогиями.",
        "questions": [
          {
            "text": "Текст вопроса",
            "options": [
              { "id": "o1", "text": "Вариант 1", "isCorrect": true },
              { "id": "o2", "text": "Вариант 2", "isCorrect": false },
              { "id": "o3", "text": "Вариант 3", "isCorrect": false },
              { "id": "o4", "text": "Вариант 4", "isCorrect": false }
            ],
            "explanation": "Аналогия из жизни → точное объяснение → правило-формула",
            "imagePrompt": "a locked safe with glowing key, dark background"
          }
        ]
      }
    ],
    "milestoneExam": [
      {
        "text": "Итоговый вопрос модуля",
        "options": [ ... ],
        "explanation": "...",
        "imagePrompt": "..."
      }
    ]
  }
]

СТРУКТУРА:
1. Если текст большой и охватывает разные темы — создавай разные модули.
2. В каждом уроке должно быть 10-15 вопросов.
3. milestoneExam должен содержать 15-20 вопросов по всему модулю.
4. Ответ должен быть ТОЛЬКО валидным JSON-массивом.
5. imagePrompt ОБЯЗАТЕЛЕН для каждого вопроса.

КОНТЕНТ УРОКОВ (content):
- Пиши Markdown живым языком, а не сухой документацией
- Используй заголовки (##), списки, **жирный** для ключевых терминов
- Добавляй примеры кода в блоки \`\`\` если тема техническая
- Каждый блок теории должен быть 200-500 слов

${PEDAGOGY_RULES}`;

interface GeneratedModule {
  title: string;
  description: string;
  lessons: Array<{
    title: string;
    content: string;
    questions: AIGeneratedQuestion[];
  }>;
  milestoneExam: AIGeneratedQuestion[];
}

export async function generateFullModuleFromText(
  rawText: string,
  config: AIConfig
): Promise<GeneratedModule[]> {
  const cleaned = await callAI(config, MODULE_SYSTEM_PROMPT, rawText);
  const parsed = JSON.parse(cleaned) as RawAIModule[];

  if (!Array.isArray(parsed)) throw new Error('AI module response is not an array');

  for (const mod of parsed) {
    if (mod.lessons) {
      for (const lesson of mod.lessons) {
        if (lesson.questions) validateAIQuestions(lesson.questions);
      }
    }
    if (mod.milestoneExam) validateAIQuestions(mod.milestoneExam);
  }

  return parsed as unknown as GeneratedModule[];
}
