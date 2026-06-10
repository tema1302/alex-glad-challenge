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
    const systemMsg: { role: 'system'; content: string } = {
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
    };
    this.messages = [systemMsg];
  }

  restoreHistory(history: ChatMessage[]): void {
    for (const msg of history) {
      this.messages.push({ role: msg.role, content: msg.text });
    }
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


// в другом файле -- обращение к супабейс как БД
import { create } from 'zustand';
import type { ChatMessage } from '@/lib/qaAgent';
import { supabase } from '@/lib/supabase';

const USER_ID = 'default';

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  addMessage: (msg: ChatMessage) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
  loadFromDB: (questionId: string) => Promise<void>;
  saveToDB: (questionId: string, msg: ChatMessage) => Promise<void>;
  deleteFromDB: (questionId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  error: null,
  addMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  clear: () => set({ messages: [], isLoading: false, error: null }),

  loadFromDB: async (questionId) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, role, content')
      .eq('question_id', questionId)
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: true });

    if (error || !data) return;

    const messages: ChatMessage[] = data.map((row: { id: string; role: string; content: string }) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant',
      text: row.content,
    }));
    set({ messages });
  },

  saveToDB: async (questionId, msg) => {
    await supabase.from('chat_messages').insert({
      id: msg.id,
      question_id: questionId,
      user_id: USER_ID,
      role: msg.role,
      content: msg.text,
    });
  },

  deleteFromDB: async (questionId) => {
    await supabase
      .from('chat_messages')
      .delete()
      .eq('question_id', questionId)
      .eq('user_id', USER_ID);
  },
}));
