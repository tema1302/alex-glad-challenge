import { create } from 'zustand';
import type { ChatMessage, TokenStats } from '@/lib/qaAgent';
import { supabase } from '@/lib/supabase';

const USER_ID = 'default';

const INITIAL_TOKEN_STATS: TokenStats = {
  lastRequest: null,
  cumulative: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  turnCount: 0,
};

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  tokenStats: TokenStats;
  addMessage: (msg: ChatMessage) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setTokenStats: (stats: TokenStats) => void;
  clear: () => void;
  loadFromDB: (questionId: string) => Promise<void>;
  saveToDB: (questionId: string, msg: ChatMessage) => Promise<void>;
  deleteFromDB: (questionId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  error: null,
  tokenStats: INITIAL_TOKEN_STATS,
  addMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setTokenStats: (tokenStats) => set({ tokenStats }),
  clear: () => set({ messages: [], isLoading: false, error: null, tokenStats: INITIAL_TOKEN_STATS }),

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
