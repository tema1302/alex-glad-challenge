import type { AIConfig } from './zai';
import { getApiUrl, getModel, getHeaders } from './zai';
import type { Question } from '@/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface QAAgentConfig {
  aiConfig: AIConfig;
}

export class QAAgent {
  private config: AIConfig;
  private messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

  constructor({ aiConfig }: QAAgentConfig) {
    this.config = aiConfig;
  }

  initContext(question: Question, userAnswer?: string): void {
    const correctOption = question.options.find(o => o.isCorrect);
    this.messages = [
      {
        role: 'system',
        content: `Ты — ИИ-ассистент в образовательном приложении. Помогаешь студенту понять учебный материал.

Контекст: студент ответил на вопрос теста.
Вопрос: ${question.text}
${userAnswer ? `Ответ студента: ${userAnswer}` : 'Студент ещё не ответил.'}
Правильный ответ: ${correctOption?.text ?? 'неизвестно'}
Пояснение: ${question.explanation}

Все варианты ответов:
${question.options.map(o => `${o.isCorrect ? '✓' : '✗'} ${o.text}`).join('\n')}

ПРАВИЛА:
- Отвечай на русском языке
- Объясняй просто, с аналогиями из жизни
- Если студент ошибся — объясни почему правильный ответ другой
- Если правильно — похвали и углуби понимание
- Отвечай кратко, 2-4 предложения
- Местами заставляй человека в голос проговорить важные фразы или термины
- Технические термины давай с английским в скобках`,
      },
    ];
  }

  async send(userMessage: string): Promise<string> {
    this.messages.push({ role: 'user', content: userMessage });

    const url = this.config.provider === 'custom' ? (this.config.apiUrl || '') : getApiUrl(this.config.provider);
    const model = getModel(this.config);

    if (!url) throw new Error('API URL не настроен');
    if (!this.config.apiKey) throw new Error('API ключ не настроен');

    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(this.config),
      body: JSON.stringify({
        model,
        messages: this.messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`API Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Пустой ответ от AI');

    this.messages.push({ role: 'assistant', content });
    return content;
  }

  reset(): void {
    this.messages = [];
  }
}

export function createQAAgent(aiConfig: AIConfig, question: Question, userAnswer?: string): QAAgent {
  const agent = new QAAgent({ aiConfig });
  agent.initContext(question, userAnswer);
  return agent;
}
