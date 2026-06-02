import { AIConfig } from './zai';
import { getApiUrl, getModel, getHeaders } from './zai';

// --- Types ---

export interface TopicCheckResult {
  score: number; // 0-100
  lessonsFit: string; // how suitable for lessons
  testsFit: string;   // how suitable for tests
  recommendation: string;
  topics: string[];    // detected topics
}

export interface GenerationComparison {
  withoutConstraints: string;
  withConstraints: string;
}

// --- Shared API call with configurable parameters ---

interface CallOptions {
  maxTokens?: number;
  stop?: string[];
  temperature?: number;
}

async function callAI(
  config: AIConfig,
  systemPrompt: string,
  userContent: string,
  opts: CallOptions = {}
): Promise<string> {
  const url = config.provider === 'custom' ? (config.apiUrl || '') : getApiUrl(config.provider);
  const model = getModel(config);

  if (!url) throw new Error('API URL is not configured');
  if (!config.apiKey) throw new Error('API key is not configured');

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
  };

  if (opts.stop && opts.stop.length > 0) {
    body.stop = opts.stop;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`${config.provider} API Error: ${response.status}`);

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');

  return content.trim();
}

// --- 1. Topic Suitability Check ---

const TOPIC_CHECK_SYSTEM = `Ты — аналитик образовательного контента.
На основе предоставленного текста оцени, насколько он подходит для создания:
1. Уроков (обучающего материала с теорией)
2. Тестов (вопросов с вариантами ответов)

ФОРМАТ ОТВЕТА — строго JSON, без markdown, без пояснений:
{
  "score": <число от 0 до 100, общая пригодность>,
  "lessonsFit": "<строка: на сколько подходит для уроков и почему>",
  "testsFit": "<строка: на сколько подходит для тестирования и почему>",
  "recommendation": "<строка: рекомендация — что можно сделать, рекомендации по улучшению>",
  "topics": ["<строка: тема 1>", "<строка: тема 2>", ...]
}

ПРАВИЛА:
- score = 0 если текст бессмысленный или слишком короткий
- score = 100 если текст идеальный для обучения и тестирования
- topics — список обнаруженных тем (2-10 штук)
- Ответ заканчивай символом }
- НЕ пиши ничего после закрывающей скобки JSON`;

export async function checkTextTopic(rawText: string, config: AIConfig): Promise<TopicCheckResult> {
  const raw = await callAI(config, TOPIC_CHECK_SYSTEM, rawText, {
    temperature: 0.3,
    maxTokens: 1024,
    stop: ['}\n', '}\n\n'],
  });

  // Try to extract JSON from response (may have trailing text)
  const jsonStr = raw.includes('{')
    ? raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
    : raw;

  const parsed = JSON.parse(jsonStr);

  return {
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    lessonsFit: String(parsed.lessonsFit || ''),
    testsFit: String(parsed.testsFit || ''),
    recommendation: String(parsed.recommendation || ''),
    topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
  };
}

// --- 2. Generation WITHOUT constraints ---

const GENERATE_PROMPT = `Проанализируй предоставленный текст и создай образовательный контент:
1. Краткий конспект ключевых идей (3-5 пунктов)
2. 5 вопросов для самопроверки с вариантами ответов
3. Рекомендации по дальнейшему изучению темы

Пиши на русском языке. Используй примеры и аналогии.`;

const SYSTEM_WITHOUT_CONSTRAINTS = `Ты — помощник в создании образовательного контента. Помоги разобрать текст для обучения.`;

export async function generateWithoutConstraints(
  rawText: string,
  config: AIConfig
): Promise<string> {
  return callAI(config, SYSTEM_WITHOUT_CONSTRAINTS, `${GENERATE_PROMPT}\n\nТекст:\n${rawText}`, {
    temperature: 0.2,
    // No format requirements, no length limits, no stop sequences
  });
}

// --- 3. Generation WITH constraints ---

const SYSTEM_WITH_CONSTRAINTS = `Ты — помощник в создании образовательного контента.
ВАЖНО: Твой ответ должен быть СТРОГО в формате JSON.

ФОРМАТ ОТВЕТА (максимум 2000 символов):
{
  "summary": ["пункт1", "пункт2", "пункт3"],
  "questions": [
    {
      "text": "вопрос",
      "options": ["A) вариант", "B) вариант", "C) вариант", "D) вариант"],
      "correct": "A"
    }
  ],
  "recommendations": ["рекомендация1", "рекомендация2"]
}

ПРАВИЛА:
- summary: 3-5 ключевых идей, каждая до 100 символов
- questions: ровно 5 вопросов, 4 варианта (A-D), указан правильный
- recommendations: 2-3 рекомендации
- Общий ответ НЕ ДОЛЖЕН превышать 2000 символов
- Завершай ответ закрывающей скобкой }
- НЕ пиши ничего ПОСЛЕ закрывающей скобки`;

export async function generateWithConstraints(
  rawText: string,
  config: AIConfig
): Promise<string> {
  return callAI(config, SYSTEM_WITH_CONSTRAINTS, `${GENERATE_PROMPT}\n\nТекст:\n${rawText}`, {
    temperature: 0.5,
    maxTokens: 1500,
    stop: ['}\n', '}\n\n', '```'],
  });
}

// --- 4. Combined: check topic + compare both generations ---

export interface FullCheckResult {
  topicCheck: TopicCheckResult;
  comparison: GenerationComparison;
}

export async function fullCheckAndCompare(
  rawText: string,
  config: AIConfig
): Promise<FullCheckResult> {
  const [topicCheck, withoutConstraints, withConstraints] = await Promise.all([
    checkTextTopic(rawText, config),
    generateWithoutConstraints(rawText, config),
    generateWithConstraints(rawText, config),
  ]);

  return {
    topicCheck,
    comparison: {
      withoutConstraints,
      withConstraints,
    },
  };
}
