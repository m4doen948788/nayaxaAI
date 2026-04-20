import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Plus, Pin, Paperclip, Mic, Volume2, Sparkles, Search, MoreVertical, ChevronDown, Code2, Terminal, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createNayaxaApi } from '../api';
import { useAuth } from '../contexts/AuthContext';
import CodeProposalReview from '../components/CodeProposalReview';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX';
const PROFIL_ID = 7;
const INSTANSI_ID = 2;
const api = createNayaxaApi(API_KEY);

export default function Chat() {
  const { currentUser } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [thinkingBrain, setThinkingBrain] = useState<string | null>(null);
  const [lastBrainUsed, setLastBrainUsed] = useState<string | null>(null);
  const [codingMode, setCodingMode] = useState(false);
  const [activeSteps, setActiveSteps] = useState<{icon: string, label: string}[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Perbaikan Auto-Expand (Performance Fix)
  useEffect(() => {
    if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  useEffect(() => {
    if (currentUser?.id) {
      fetchSessions();
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if ((messages.length > 0 || isTyping) && scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isNearBottom = scrollTop + clientHeight >= scrollHeight - 300;
      
      // Jika pesan baru dari user, atau kita sudah di bawah, scroll ke bawah
      if (isNearBottom || (messages.length > 0 && messages[messages.length - 1].role === 'user')) {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, isTyping]);

  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await api.getSessions(currentUser?.id || 0);
      if (res.success) setSessions(res.sessions || []);
    } catch (err) { console.error(err); }
    setLoadingSessions(false);
  };

  const loadSession = async (id: string) => {
    setActiveSessionId(id);
    try {
      const res = await api.getHistoryBySession(id);
      if (res.success) setMessages(res.history);
    } catch (err) { console.error(err); }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    const msg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setIsTyping(true);
    setActiveSteps([]);
    setThinkingBrain('DeepSeek');

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const res = await api.chatStream(
        {
          message: msg,
          user_id: currentUser?.id,
          user_name: currentUser?.name,
          session_id: activeSessionId,
          profil_id: currentUser?.id,
          instansi_id: INSTANSI_ID,
          coding_mode: codingMode
        },
        (step) => {
          setActiveSteps(prev => {
            if (prev.length > 0 && prev[prev.length - 1].label === step.label) return prev;
            return [...prev, step];
          });
        },
        abortControllerRef.current.signal
      );
      setMessages(prev => [...prev, { role: 'model', content: res.text, brain_used: res.brain_used }]);
      setLastBrainUsed(res.brain_used);
      if (!activeSessionId) {
        setActiveSessionId(res.session_id);
        fetchSessions();
      } else {
        fetchSessions();
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Chat stream aborted by user.');
      } else {
        console.error(err);
        setMessages(prev => [...prev, { role: 'model', content: 'Gagal terhubung ke Nayaxa AI Engine.' }]);
      }
    } finally {
      setIsTyping(false);
      setActiveSteps([]);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sessions Sidebar */}
      <div className="w-80 bg-slate-900/30 border-r border-white/5 flex flex-col">
        <div className="p-6">
          <button 
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-2xl transition-all shadow-lg shadow-indigo-600/20"
          >
            <Plus size={18} /> New Conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2 mb-4">Recent Sessions</h3>
          {loadingSessions ? (
            <div className="space-y-4 px-2">
               {[1,2,3].map(i => <div key={i} className="h-12 bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            sessions.map((sess, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => loadSession(sess.session_id)}
                className={`w-full group text-left p-4 rounded-2xl transition-all border ${activeSessionId === sess.session_id ? 'bg-indigo-600/10 border-indigo-500/50 text-white' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate flex-1">{sess.title || 'Untitled Conversation'}</span>
                  {sess.is_pinned && <Pin size={12} className="text-indigo-400 shrink-0" />}
                </div>
                <div className="text-[10px] opacity-40 mt-1">{new Date(sess.last_msg).toLocaleDateString()}</div>
              </motion.button>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-h-0 relative bg-slate-950/20">
        <header className="p-6 border-b border-white/5 flex items-center justify-between backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${activeSessionId ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/20' : 'bg-slate-800 text-slate-400'}`}>
              <Bot size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-white">Nayaxa Assistant</h2>
                {activeSessionId && (
                   <div className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black border border-white/20 ${
                     (thinkingBrain || lastBrainUsed || messages.findLast(m => m.role === 'model')?.brain_used || 'DeepSeek')?.toLowerCase().includes('deepseek') ? 'bg-teal-500' : 'bg-indigo-500'
                   }`}>
                     {(thinkingBrain || lastBrainUsed || messages.findLast(m => m.role === 'model')?.brain_used || 'DeepSeek')?.toLowerCase().includes('deepseek') ? 'D' : 'G'}
                   </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span className="text-[13px] text-slate-400 font-medium">Asisten AI Cerdas Anda</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Coding Agent Mode Toggle */}
            <button
              onClick={() => setCodingMode(prev => !prev)}
              title={codingMode ? 'Coding Agent: ON — Klik untuk nonaktifkan' : 'Aktifkan Coding Agent Mode'}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-[12px] font-bold ${
                codingMode
                  ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400 shadow-lg shadow-emerald-600/10'
                  : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300'
              }`}
            >
              <Terminal size={15} className={codingMode ? 'animate-pulse' : ''} />
              <span className="hidden sm:inline">{codingMode ? 'Code Agent: ON' : 'Code Agent'}</span>
            </button>
            <button className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-all"><Search size={18} /></button>
            <button className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-all"><MoreVertical size={18} /></button>
          </div>
        </header>

        <div 
          className="flex-1 overflow-y-auto px-6 py-8 space-y-8 custom-scrollbar relative"
          ref={scrollContainerRef}
          onScroll={() => {
            if (scrollContainerRef.current) {
              const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
              setShowScrollButton(scrollTop + clientHeight < scrollHeight - 300);
            }
          }}
        >
          <AnimatePresence initial={false}>
            {messages.length === 0 && !isTyping && (
                <motion.div 
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto"
                >
                    <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border ${
                      codingMode
                        ? 'bg-emerald-600/10 text-emerald-500 border-emerald-600/20'
                        : 'bg-indigo-600/10 text-indigo-500 border-indigo-600/20'
                    }`}>
                        {codingMode ? <Code2 size={40} /> : <Sparkles size={40} />}
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2">
                      {codingMode ? 'Nayaxa Coding Agent Siap' : 'How can I help you today?'}
                    </h3>
                    <p className="text-slate-400 text-sm">
                      {codingMode
                        ? 'Saya bisa membaca, menganalisis, dan memodifikasi kode proyek Anda. Silakan bertanya atau minta saya untuk memeriksa suatu file.'
                        : 'Say hi, upload a document, or ask about your dashboard performance statistics.'
                      }
                    </p>
                    <div className="grid grid-cols-1 gap-3 w-full mt-8">
                        {(codingMode ? [
                            "Jelaskan struktur folder proyek nayaxa-engine",
                            "Baca dan analisis file nayaxaDeepSeekService.js",
                            "Cari di mana fungsi chatWithNayaxa dipanggil"
                        ] : [
                            "Analyze my team's performance",
                            "Explain the latest anomaly alerts",
                            "Draft a report based on my activities"
                        ]).map((t, i) => (
                            <button key={i} onClick={() => setInput(t)} className="p-4 rounded-2xl bg-white/5 border border-white/5 text-sm text-slate-300 hover:bg-white/10 hover:border-indigo-500/30 transition-all text-left">
                                {t}
                            </button>
                        ))}
                    </div>
                </motion.div>
            )}
            
            {messages.map((m, i) => (
              <motion.div 
                key={i} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${m.role === 'user' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-white/5 text-indigo-400'}`}>
                  {m.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                </div>
                <div className={`max-w-[75%] p-6 rounded-3xl text-[16px] ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white/5 border border-white/10 rounded-tl-none'}`}>
                  <div className="prose prose-invert max-w-none text-slate-200 leading-relaxed font-normal text-[16px] text-justify prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-xl">
                    {m.content.split(/(\[NAYAXA_PROPOSAL:[^\]]+\])/g).map((part: string, index: number) => {
                      if (part.startsWith('[NAYAXA_PROPOSAL:')) {
                        const id = part.match(/\[NAYAXA_PROPOSAL:([^\]]+)\]/)?.[1] || '';
                        return <CodeProposalReview key={index} proposalId={id} api={api} />;
                      }
                      return <ReactMarkdown key={index} remarkPlugins={[remarkGfm]}>{part}</ReactMarkdown>;
                    })}
                  </div>
                </div>
              </motion.div>
            ))}
            
            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0 border border-white/5 text-indigo-400">
                  <Bot size={18} />
                </div>
                <div className="bg-white/5 border border-white/10 p-5 rounded-3xl rounded-tl-none min-w-[220px]">
                  {/* Thought Trace UI */}
                  {activeSteps.length > 0 ? (
                    <div className="space-y-2">
                      {activeSteps.map((step, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex items-center gap-2.5 ${
                            i === activeSteps.length - 1 ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          <span className="text-base leading-none">{step.icon}</span>
                          <span className={`text-[12px] font-medium ${
                            i === activeSteps.length - 1 ? 'text-emerald-300' : 'text-slate-500 line-through'
                          }`}>{step.label}</span>
                          {i === activeSteps.length - 1 && (
                            <span className="ml-auto flex gap-0.5">
                              {[0,1,2].map(j => (
                                <span key={j} className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce"
                                  style={{ animationDelay: `${j * 0.15}s` }} />
                              ))}
                            </span>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={scrollRef} />

          {/* Jump to Latest Button */}
          <AnimatePresence>
            {showScrollButton && (
              <motion.button
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                onClick={() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="fixed bottom-32 right-12 z-50 p-4 bg-indigo-600 text-white rounded-full shadow-2xl hover:bg-indigo-500 transition-all border border-white/10 active:scale-95 flex items-center justify-center"
                title="Loncat ke chat terbaru"
              >
                <ChevronDown className="w-6 h-6" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Input Bar */}
        <div className="p-8">
            <div className="glass-card p-2 border-white/10 flex items-end gap-2 max-w-4xl mx-auto shadow-2xl">
                <button className="p-3 text-slate-400 hover:text-white transition-all rounded-xl hover:bg-white/5"><Paperclip size={20} /></button>
                <div className="flex-1 px-4 py-2">
                    <textarea 
                        ref={inputRef}
                        value={input}
                        rows={1}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder="Say something to Nayaxa..."
                        className="w-full bg-transparent border-none focus:outline-none text-white text-[16px] resize-none min-h-[24px] max-h-40 py-1 overflow-y-auto custom-scrollbar"
                    />
                </div>
                <div className="flex items-center gap-1 p-1 mb-1">
                    <button className="p-2 text-slate-400 hover:text-white transition-all rounded-xl hover:bg-white/5"><Mic size={20} /></button>
                    <button className="p-2 text-slate-400 hover:text-white transition-all rounded-xl hover:bg-white/5"><Volume2 size={20} /></button>
                    {isTyping ? (
                      <button 
                        onClick={handleStop}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all active:scale-90"
                      >
                        <Square size={16} fill="currentColor" />
                      </button>
                    ) : (
                      <button 
                        onClick={handleSend}
                        disabled={!input.trim()}
                        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all shadow-lg ${
                            input.trim() 
                            ? 'bg-indigo-600 text-white shadow-indigo-600/30' 
                            : 'bg-white/5 text-slate-600 cursor-not-allowed border border-white/5'
                        }`}
                      >
                        <Send size={18} />
                      </button>
                    )}
                </div>
            </div>
            <p className="text-center text-[10px] text-slate-500 mt-4 uppercase tracking-tighter">
              {codingMode 
                ? '⚠ Coding Agent ON — Nayaxa memiliki akses baca/tulis file proyek.'
                : 'Nayaxa AI can make mistakes. Verify important information.'
              }
            </p>
        </div>
      </div>
    </div>
  );
}
