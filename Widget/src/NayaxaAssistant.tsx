import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createNayaxaApi } from './api';
import NayaxaChart from './NayaxaChart';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from './Mermaid';
import { Send, Bot, User, Zap, X } from 'lucide-react';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX';

export default function NayaxaAssistant() {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const api = createNayaxaApi(API_KEY);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Performance Fix: Auto-expand textarea
  useEffect(() => {
    if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [inputVal]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!inputVal.trim() || isTyping) return;
    const msg = inputVal;
    setInputVal('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setIsTyping(true);

    try {
      const res = await api.chat({
        message: msg,
        session_id: sessionId,
        user_id: 7, // Default for widget
        user_name: 'Widget User'
      });

      if (res.success) {
        setMessages(prev => [...prev, { role: 'model', content: res.text, brain_used: res.brain_used }]);
        if (res.session_id) setSessionId(res.session_id);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', content: 'Gagal koneksi.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      <div className="bg-indigo-600 p-4 text-white flex items-center gap-2">
        <Bot size={20} />
        <h3 className="font-bold text-sm">Nayaxa Assistant</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[90%] p-3 rounded-2xl text-sm ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-black border shadow-sm'}`}>
              <div className="prose prose-sm prose-slate">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || ''}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {isTyping && <div className="text-xs text-slate-400 animate-pulse">Nayaxa sedang mengetik...</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 bg-white border-t flex items-center gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Tanya Nayaxa..."
          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none resize-none"
        />
        <button onClick={handleSend} className="p-2 bg-indigo-600 text-white rounded-lg">
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
