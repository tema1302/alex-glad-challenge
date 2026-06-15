'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, MessageCircle, Loader2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Question } from '@/types';
import { QAAgent, createQAAgent, type ChatMessage, type TokenStats } from '@/lib/qaAgent';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useChatStore } from '@/stores/useChatStore';
import { getBuiltinAIConfig, type AIConfig } from '@/lib/zai';

interface QuestionChatProps {
  question: Question;
  userAnswer?: string;
}

function resolveAIConfig(): AIConfig | null {
  const builtin = getBuiltinAIConfig('deepseek') || getBuiltinAIConfig('openrouter');
  if (builtin) return builtin;

  const s = useSettingsStore.getState();
  const provider = s.aiProvider;
  const userKey = provider === 'deepseek' ? s.deepseekKey
    : provider === 'openrouter' ? s.openrouterKey
    : s.customApiKey;
  if (!userKey) return null;

  const model = provider === 'deepseek' ? 'deepseek-chat'
    : provider === 'openrouter' ? (s.openrouterModel || 'google/gemini-2.0-flash-001')
    : s.customModel;
  const apiUrl = provider === 'custom' ? s.customApiUrl : undefined;
  return { provider, apiKey: userKey, model, apiUrl };
}

function formatCost(cost: number): string {
  if (cost < 0.001) return '$0.000';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export function QuestionChat({ question, userAnswer }: QuestionChatProps) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [agent, setAgent] = useState<QAAgent | null>(null);
  const messages = useChatStore(s => s.messages);
  const isLoading = useChatStore(s => s.isLoading);
  const error = useChatStore(s => s.error);
  const tokenStats = useChatStore(s => s.tokenStats);
  const addMessage = useChatStore(s => s.addMessage);
  const setLoading = useChatStore(s => s.setLoading);
  const setError = useChatStore(s => s.setError);
  const setTokenStats = useChatStore(s => s.setTokenStats);
  const clear = useChatStore(s => s.clear);
  const loadFromDB = useChatStore(s => s.loadFromDB);
  const saveToDB = useChatStore(s => s.saveToDB);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Init agent + load history from DB when question changes
  useEffect(() => {
    const config = resolveAIConfig();
    if (!config) {
      setAgent(null);
      return;
    }
    const newAgent = createQAAgent(config, question, userAnswer, (stats: TokenStats) => {
      setTokenStats(stats);
    });
    setAgent(newAgent);
    clear();

    loadFromDB(question.id).then(() => {
      const history = useChatStore.getState().messages;
      if (history.length > 0) {
        newAgent.restoreHistory(history);
      }
    });
  }, [question.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !agent || isLoading) return;

    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', text };
    addMessage(userMsg);
    saveToDB(question.id, userMsg);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const reply = await agent.send(text);
      const aiMsg: ChatMessage = { id: `a${Date.now()}`, role: 'assistant', text: reply };
      addMessage(aiMsg);
      saveToDB(question.id, aiMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [input, agent, isLoading, question.id, addMessage, setLoading, setError, saveToDB]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const config = resolveAIConfig();
  if (!config) return null;

  const contextPct = agent ? agent.getContextUtilization() : 0;
  const isNearLimit = contextPct > 0.7;
  const isOverLimit = contextPct > 0.95;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-[var(--primary-border)] bg-[var(--primary-ghost)] transition-all active:scale-[0.98]"
      >
        <span className="flex items-center gap-2 text-[13px] font-bold text-[var(--primary-color)]">
          <MessageCircle size={15} /> Спросить ИИ
          {tokenStats && tokenStats.turnCount > 0 && (
            <span className="text-[10px] font-normal text-[var(--text-muted)]">
              {tokenStats.cumulative.totalTokens} токенов
            </span>
          )}
        </span>
        {expanded ? <ChevronUp size={15} className="text-[var(--text-muted)]" /> : <ChevronDown size={15} className="text-[var(--text-muted)]" />}
      </button>

      {expanded && (
        <div className="mt-2 rounded-xl border border-[var(--card-border)] bg-[var(--bg-elevated)] overflow-hidden animate-fade-in">
          {/* Token stats bar */}
          {tokenStats && tokenStats.turnCount > 0 && agent && (
            <div className={`px-3 py-2 border-b border-[var(--card-border)] text-[10px] flex items-center justify-between ${
              isOverLimit ? 'bg-red-500/10 text-red-400' : isNearLimit ? 'bg-yellow-500/10 text-yellow-400' : 'text-[var(--text-muted)]'
            }`}>
              <div className="flex items-center gap-3">
                <span>Запрос: {tokenStats.lastRequest?.promptTokens ?? 0}</span>
                <span>Ответ: {tokenStats.lastRequest?.completionTokens ?? 0}</span>
                <span>Всего: {tokenStats.cumulative.totalTokens}</span>
                <span>Ходов: {tokenStats.turnCount}</span>
                <span>Стоимость: {formatCost(agent.getEstimatedCost())}</span>
              </div>
              {(isNearLimit || isOverLimit) && (
                <span className="flex items-center gap-1 font-bold">
                  <AlertTriangle size={10} />
                  {isOverLimit ? 'Лимит превышен!' : `${Math.round(contextPct * 100)}% контекста`}
                </span>
              )}
            </div>
          )}

          {/* Context progress bar */}
          {tokenStats && tokenStats.turnCount > 0 && agent && (
            <div className="px-3 pt-1.5 pb-0.5">
              <div className="w-full h-1 bg-black/30 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, contextPct * 100)}%`,
                    background: isOverLimit
                      ? 'linear-gradient(90deg, #FF2D6B, #FF0000)'
                      : isNearLimit
                        ? 'linear-gradient(90deg, #FFB800, #FF6600)'
                        : 'linear-gradient(90deg, var(--primary-color), var(--success-color))',
                  }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-0.5">
                <span>0</span>
                <span>{agent.getModelLimit().toLocaleString()} токенов лимит</span>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="max-h-60 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-[12px] text-[var(--text-muted)] text-center py-3">
                Задайте вопрос по этому заданию
              </p>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[var(--primary-ghost)] text-[var(--primary-color)] border border-[var(--primary-border)]'
                    : 'bg-[var(--surface-color)] text-[var(--text-sub)] border border-[var(--card-border)]'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="prose-custom prose-chat">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ) : msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-xl bg-[var(--surface-color)] border border-[var(--card-border)]">
                  <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />
                </div>
              </div>
            )}
            {error && (
              <p className="text-[12px] text-[var(--danger-color)] text-center">{error}</p>
            )}
          </div>

          <div className="flex items-center gap-2 p-2 border-t border-[var(--card-border)]">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ваш вопрос..."
              disabled={isLoading || isOverLimit}
              className="flex-1 bg-transparent text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none disabled:opacity-30"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading || isOverLimit}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--primary-color)] text-black disabled:opacity-30 active:scale-90 transition-all"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
