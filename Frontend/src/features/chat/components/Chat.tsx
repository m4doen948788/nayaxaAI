import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Plus, Pin, Paperclip, Mic, Volume2, Sparkles, Search, MoreVertical, ChevronDown, Code2, Square, X, Image as ImageIcon, FileText, Copy, Check, LogIn, UserPlus, LogOut, Share2, Pencil, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createNayaxaApi } from '@/src/api';
import { useAuth } from '@/src/contexts/AuthContext';
import CodeProposalReview from '@/src/features/chat/components/CodeProposalReview';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX';
const PROFIL_ID = 7;
const INSTANSI_ID = 2;
const api = createNayaxaApi(API_KEY);

const TableWithCopy = ({ children }: { children: React.ReactNode }) => {
  const [copied, setCopied] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const handleCopy = () => {
    if (!tableRef.current) return;
    const rows = Array.from(tableRef.current.querySelectorAll('tr'));
    const plainText = rows.map(row => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      return cells.map(cell => cell.textContent?.trim() || '').join('\t');
    }).join('\n');

    const htmlTable = `
      <style>
        table { border-collapse: collapse; width: 100%; border: 1px solid #e2e8f0; font-family: sans-serif; }
        th { background-color: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0; padding: 12px 8px; text-align: left; }
        td { border: 1px solid #e2e8f0; padding: 12px 8px; }
      </style>
      <table>
        ${tableRef.current.innerHTML}
      </table>
    `;

    try {
      const blobHtml = new Blob([htmlTable], { type: 'text/html' });
      const blobText = new Blob([plainText], { type: 'text/plain' });
      const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
      navigator.clipboard.write(data).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch (err) {
      navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative group/table my-4 border border-slate-200 rounded-2xl overflow-hidden bg-slate-50 shadow-lg">
      <div className="absolute right-3 top-3 z-10">
        <button
          onClick={handleCopy}
          className={`p-2 rounded-xl transition-all flex items-center gap-2 text-xs font-bold shadow-lg ${
            copied ? 'bg-emerald-500 text-white' : 'bg-indigo-600/80 hover:bg-indigo-600 text-white opacity-0 group-hover/table:opacity-100'
          }`}
        >
          {copied ? <Check size={14} className="text-white" /> : <Copy size={14} className="text-white" />}
          {copied ? 'Tersalin' : 'Salin Tabel'}
        </button>
      </div>
      <div className="overflow-x-auto p-4 custom-scrollbar" ref={tableRef}>
        {children}
      </div>
    </div>
  );
};

export default function Chat() {
  const { currentUser, setCurrentUser, logout } = useAuth();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
  const [selectedFiles, setSelectedFiles] = useState<{ base64: string, mimeType: string, name: string, action?: string }[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingThought, setThinkingThought] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const getEffectiveUserId = () => {
    if (currentUser?.id) return currentUser.id;
    let guestId = localStorage.getItem('nayaxa_guest_id');
    if (!guestId) {
      guestId = String(Math.floor(100000 + Math.random() * 900000));
      localStorage.setItem('nayaxa_guest_id', guestId);
    }
    return parseInt(guestId, 10);
  };

  useEffect(() => {
    fetchSessions();
  }, [currentUser?.id]);

  useEffect(() => {
    if ((messages.length > 0 || isTyping) && scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isNearBottom = scrollTop + clientHeight >= scrollHeight - 300;
      if (isNearBottom || (messages.length > 0 && messages[messages.length - 1].role === 'user')) {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, isTyping, streamingContent, activeSteps, thinkingThought]);

  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await api.getSessions(getEffectiveUserId());
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

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.session-menu-container')) {
        setActiveMenuSessionId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleTogglePin = async (e: React.MouseEvent, sess: any) => {
    e.stopPropagation();
    setActiveMenuSessionId(null);
    try {
      const effectiveId = getEffectiveUserId();
      await api.togglePinSession(sess.session_id, effectiveId, !sess.is_pinned);
      fetchSessions();
      setToastMessage(sess.is_pinned ? 'Pin dibatalkan' : 'Percakapan disematkan');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setActiveMenuSessionId(null);
    try {
      await api.deleteSession(sessionId);
      if (activeSessionId === sessionId) {
        startNewChat();
      }
      fetchSessions();
      setToastMessage('Percakapan dihapus');
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartRename = (e: React.MouseEvent, sess: any) => {
    e.stopPropagation();
    setActiveMenuSessionId(null);
    setEditingSessionId(sess.session_id);
    setEditingTitle(sess.title || 'Untitled Conversation');
  };

  const handleSaveRename = async (sessionId: string) => {
    if (!editingTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    try {
      const effectiveId = getEffectiveUserId();
      await api.renameSession(sessionId, editingTitle.trim(), effectiveId);
      setEditingSessionId(null);
      fetchSessions();
      setToastMessage('Judul berhasil diubah');
    } catch (err) {
      console.error(err);
      setEditingSessionId(null);
    }
  };

  const handleShareSession = (e: React.MouseEvent, sess: any) => {
    e.stopPropagation();
    setActiveMenuSessionId(null);
    const shareUrl = `${window.location.origin}/chat?session=${sess.session_id}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl);
      setToastMessage('Tautan percakapan disalin');
    }
  };

  const processFiles = (files: File[]) => {
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        setSelectedFiles(prev => [...prev, { base64, mimeType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
    if (e.target) e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const files = items
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length > 0) processFiles(files);
  };

  const handleSend = async () => {
    if ((!input.trim() && selectedFiles.length === 0) || isTyping) return;
    let fileInstructions = "";
    selectedFiles.forEach(f => {
      if (f.action) fileInstructions += `[FILE: ${f.name} -> ACTION: ${f.action}]\n`;
    });
    const msg = fileInstructions ? `${fileInstructions}\n${input}` : input;
    const attachments = [...selectedFiles];
    setInput('');
    setSelectedFiles([]);
    setMessages(prev => [...prev, { role: 'user', content: input || (attachments.length > 0 ? "*(Mengirimkan lampiran)*" : "") }]);
    setTimeout(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
    setIsTyping(true);
    setActiveSteps([]);
    setThinkingBrain('DeepSeek');
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();    try {
      setStreamingContent('');
      setThinkingThought('');

      // Dynamically format client time with timezone offset suffix (WIB, WITA, WIT, GMT)
      const offset = -new Date().getTimezoneOffset() / 60;
      let tzSuffix = 'WIB';
      if (offset === 8) tzSuffix = 'WITA';
      else if (offset === 9) tzSuffix = 'WIT';
      else if (offset > 0) tzSuffix = `GMT+${offset}`;
      else if (offset < 0) tzSuffix = `GMT${offset}`;

      const clientTimeFormatted = new Date().toLocaleDateString('id-ID', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }) + ' ' + tzSuffix;

      const effectiveUserId = getEffectiveUserId();
      const effectiveUserName = currentUser?.name || 'Pengguna Umum';

      const res = await api.chatStream(
        {
          message: msg,
          user_id: effectiveUserId,
          user_name: effectiveUserName,
          session_id: activeSessionId,
          profil_id: effectiveUserId,
          instansi_id: INSTANSI_ID,
          coding_mode: codingMode,
          files: attachments,
          client_time: clientTimeFormatted
        },
        (step) => {
          setActiveSteps(prev => {
            if (prev.length > 0 && prev[prev.length - 1].label === step.label) return prev;
            return [...prev, step];
          });
        },
        (chunk) => { setStreamingContent(prev => prev + chunk); },
        (thoughtChunk) => { setThinkingThought(prev => prev + thoughtChunk); },
        abortControllerRef.current.signal
      );
      setMessages(prev => [...prev, { role: 'model', content: res.text || streamingContent || '*(Tidak ada respons dari Nayaxa)*', brain_used: res.brain_used }]);
      setStreamingContent('');
      setThinkingThought('');
      setLastBrainUsed(res.brain_used);
      fetchSessions();
      if (!activeSessionId) setActiveSessionId(res.session_id);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(err);
        let errorMsg = "Gagal terhubung ke Nayaxa AI Engine.";
        if (err.message?.includes('503') || err.message?.includes('high demand')) errorMsg = "Nayaxa sedang sibuk, silakan coba beberapa saat lagi.";
        setMessages(prev => [...prev, { role: 'model', content: errorMsg }]);
      }
    } finally {
      setIsTyping(false);
      setActiveSteps([]);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  const startNewChat = () => { setActiveSessionId(null); setMessages([]); };

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (authMode === 'register') {
      if (!authName.trim()) {
        setAuthError('Silakan masukkan nama lengkap Anda.');
        return;
      }
      const newUser = {
        id: Date.now(),
        name: authName.trim(),
        role: 'Pengguna Terdaftar',
        avatar: authName.trim()[0].toUpperCase()
      };
      setCurrentUser(newUser);
      setIsAuthModalOpen(false);
      setAuthName('');
      setAuthEmail('');
      setAuthPassword('');
    } else {
      if (!authEmail.trim()) {
        setAuthError('Silakan masukkan nama atau email.');
        return;
      }
      const userName = authEmail.includes('@') ? authEmail.split('@')[0] : authEmail.trim();
      const loggedInUser = {
        id: Date.now(),
        name: userName,
        role: 'Pengguna Terdaftar',
        avatar: userName[0].toUpperCase()
      };
      setCurrentUser(loggedInUser);
      setIsAuthModalOpen(false);
      setAuthEmail('');
      setAuthPassword('');
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-white text-slate-900 font-outfit">
      {/* Sidebar */}
      <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col h-full shrink-0">
        {/* Branding Header */}
        <div className="p-5 pb-0 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-600/30">
            <Bot className="text-white" size={24} />
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight text-slate-900 leading-tight">
              Nayaxa <span className="text-indigo-600">AI</span>
            </div>
            <div className="text-[10px] text-slate-400 font-medium">Asisten Cerdas Publik</div>
          </div>
        </div>

        {/* New Chat Button */}
        <div className="p-5 pb-3">
          <button onClick={startNewChat} className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-2xl transition-all shadow-lg shadow-indigo-600/20">
            <Plus size={18} /> Percakapan Baru
          </button>
        </div>

        {/* Recents Sessions List */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1 custom-scrollbar">
          <div className="text-xs font-semibold text-slate-400 px-3 py-2">Recents</div>
          {loadingSessions ? (
            <div className="space-y-3 px-2">
               {[1,2,3].map(i => <div key={i} className="h-9 bg-slate-200/50 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            sessions.map((sess, i) => (
              <div
                key={sess.session_id || i}
                className="relative group session-menu-container"
              >
                {editingSessionId === sess.session_id ? (
                  <div className="px-3 py-1.5 flex items-center gap-1 bg-white border border-indigo-300 rounded-xl shadow-sm">
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(sess.session_id);
                        if (e.key === 'Escape') setEditingSessionId(null);
                      }}
                      onBlur={() => handleSaveRename(sess.session_id)}
                      autoFocus
                      className="w-full text-sm bg-transparent border-none focus:outline-none text-slate-800"
                    />
                  </div>
                ) : (
                  <div
                    onClick={() => loadSession(sess.session_id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all cursor-pointer ${
                      activeSessionId === sess.session_id 
                        ? 'bg-slate-200/70 text-slate-900 font-medium' 
                        : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate flex-1 mr-1">
                      {sess.is_pinned && (
                        <Pin size={13} className="text-indigo-600 rotate-45 shrink-0" />
                      )}
                      <span className="truncate text-[13.5px] leading-snug">
                        {sess.title || 'Untitled Conversation'}
                      </span>
                    </div>

                    {/* Three-dots button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuSessionId(
                          activeMenuSessionId === sess.session_id ? null : sess.session_id
                        );
                      }}
                      className={`p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-300/50 transition-all shrink-0 ${
                        activeMenuSessionId === sess.session_id 
                          ? 'opacity-100 bg-slate-300/50 text-slate-700' 
                          : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                )}

                {/* Dropdown Popup Menu */}
                {activeMenuSessionId === sess.session_id && (
                  <div
                    className="absolute left-[70%] top-6 z-50 w-52 bg-white rounded-2xl p-1.5 shadow-2xl border border-slate-100 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleShareSession(e, sess)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 hover:bg-slate-50 transition-all text-left font-medium"
                    >
                      <Share2 size={16} className="text-slate-600 shrink-0" />
                      <span>Share conversation</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(e, sess)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 hover:bg-slate-50 transition-all text-left font-medium"
                    >
                      <Pin size={16} className="text-slate-600 shrink-0" />
                      <span>{sess.is_pinned ? 'Unpin' : 'Pin'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleStartRename(e, sess)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 hover:bg-slate-50 transition-all text-left font-medium"
                    >
                      <Pencil size={16} className="text-slate-600 shrink-0" />
                      <span>Rename</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleDeleteSession(e, sess.session_id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-rose-600 hover:bg-rose-50 transition-all text-left font-medium"
                    >
                      <Trash2 size={16} className="text-rose-600 shrink-0" />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer: User Status & Auth Buttons */}
        <div className="p-4 mt-auto border-t border-slate-200 bg-white/70 backdrop-blur-sm">
          {currentUser ? (
            <div className="space-y-3">
              {/* User Status Badge (Hanya tampil saat sudah login) */}
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold shrink-0 shadow-md">
                  {currentUser.avatar || currentUser.name[0]?.toUpperCase() || 'U'}
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-sm font-bold text-slate-900 truncate">{currentUser.name}</p>
                  <p className="text-[11px] text-indigo-600 font-semibold truncate flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block"></span>
                    {currentUser.role || 'Pengguna'}
                  </p>
                </div>
              </div>

              {/* Tombol Keluar */}
              <button 
                onClick={logout}
                className="w-full py-2.5 px-3 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-100 text-xs font-bold text-rose-600 transition-all flex items-center justify-center gap-1.5"
              >
                <LogOut size={14} /> Keluar Akun
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => { setAuthMode('login'); setAuthError(''); setIsAuthModalOpen(true); }}
                className="py-2.5 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 hover:text-indigo-600 transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <LogIn size={14} /> Masuk
              </button>
              <button 
                onClick={() => { setAuthMode('register'); setAuthError(''); setIsAuthModalOpen(true); }}
                className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white transition-all flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/20"
              >
                <UserPlus size={14} /> Buat Akun
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-h-0 relative bg-white shadow-inner">
        <header className="p-6 border-b border-slate-100 flex items-center justify-between backdrop-blur-md z-10 bg-white/80">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${activeSessionId ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-slate-100 text-slate-400'}`}>
              <Bot size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-slate-900">Nayaxa Assistant</h2>
                {activeSessionId && (
                   <div className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black border border-slate-200 ${
                     (thinkingBrain || lastBrainUsed || 'DeepSeek').toLowerCase().includes('deepseek') ? 'bg-teal-500' : 'bg-indigo-500'
                   }`}>
                     {(thinkingBrain || lastBrainUsed || 'DeepSeek').toLowerCase().includes('deepseek') ? 'D' : 'G'}
                   </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span className="text-[13px] text-slate-500 font-medium">Asisten AI Cerdas Anda</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:text-indigo-600 border border-slate-100 transition-all"><Search size={18} /></button>
            <button className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:text-indigo-600 border border-slate-100 transition-all"><MoreVertical size={18} /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 custom-scrollbar relative" ref={scrollContainerRef} onScroll={() => { if (scrollContainerRef.current) { const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current; setShowScrollButton(scrollTop + clientHeight < scrollHeight - 300); } }}>
          <AnimatePresence initial={false}>
            {messages.length === 0 && !isTyping && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
                    <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border ${codingMode ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                        {codingMode ? <Code2 size={40} /> : <Sparkles size={40} />}
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">{codingMode ? 'Nayaxa Coding Agent Siap' : 'Halo! Ada yang bisa Nayaxa bantu?'}</h3>
                    <p className="text-slate-500 text-sm">{codingMode ? 'Saya bisa membaca, menganalisis, dan memodifikasi kode proyek Anda.' : 'Tanyakan apa saja, buat draf dokumen/surat resmi, atau unggah file untuk dianalisis.'}</p>
                    <div className="grid grid-cols-1 gap-3 w-full mt-8">
                        {(codingMode ? ["Jelaskan struktur folder proyek", "Baca file nayaxaDeepSeekService.js"] : ["Apa saja tugas dan keahlian Nayaxa AI?", "Bantu buatkan draf surat resmi", "Analisis dan rangkum dokumen saya"]).map((t, i) => (
                            <button key={i} onClick={() => setInput(t)} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-sm text-slate-600 hover:bg-white hover:border-indigo-500/30 transition-all text-left shadow-sm">{t}</button>
                        ))}
                    </div>
                </motion.div>
            )}
            
            {messages.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${m.role === 'user' ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 border-slate-200 text-indigo-600'}`}>
                  {m.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                </div>
                <div className={`max-w-[75%] p-6 rounded-3xl text-[16px] shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-50 border border-slate-200 rounded-tl-none'}`}>
                  <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed font-normal text-[16px] text-justify prose-p:my-1 prose-headings:mb-2 prose-headings:mt-4">
                    {(typeof m.content === 'string' ? m.content.replace(/\[FILE:[\s\S]*?ACTION:[\s\S]*?\]/gi, '').trim() || (m.role === 'user' ? '*(Mengirimkan lampiran)*' : '') : m.content || '').split(/(\[NAYAXA_PROPOSAL:[^\]]+\])/g).map((part: string, index: number) => {
                      if (part.startsWith('[NAYAXA_PROPOSAL:')) {
                        const id = part.match(/\[NAYAXA_PROPOSAL:([^\]]+)\]/)?.[1] || '';
                        return <CodeProposalReview key={index} proposalId={id} api={api} />;
                      }
                      return <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} components={{ table({ children }) { return <TableWithCopy>{children}</TableWithCopy>; } }}>{part}</ReactMarkdown>;
                    })}
                  </div>
                </div>
              </motion.div>
            ))}
            
            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200 text-indigo-600"><Bot size={18} /></div>
                <div className="bg-slate-50 border border-slate-200 p-5 rounded-3xl rounded-tl-none min-w-[220px] max-w-[90%] shadow-sm">
                  {thinkingThought && (
                    <div className="mb-4 bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100">
                        <div className="flex items-center gap-2 mb-2 text-indigo-600 font-bold text-[11px] uppercase tracking-wider"><Sparkles size={12} className="animate-pulse" /> PROSES BERPIKIR NAYAXA</div>
                        <div className="text-[13px] text-slate-600 italic leading-relaxed whitespace-pre-wrap font-medium">{thinkingThought}<span className="inline-block w-1 h-3 ml-1 bg-indigo-600 animate-pulse" /></div>
                    </div>
                  )}
                  {activeSteps.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {activeSteps.map((step, i) => (
                        <div key={i} className={`flex items-center gap-2.5 ${i === activeSteps.length - 1 ? 'text-emerald-600' : 'text-slate-400'}`}>
                          <span className="text-base leading-none">{step.icon}</span>
                          <span className={`text-[12px] font-bold ${i === activeSteps.length - 1 ? 'text-emerald-600' : 'text-slate-400 line-through'}`}>{step.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {streamingContent ? (
                    <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed font-normal text-[16px] text-justify prose-p:my-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table({ children }) { return <TableWithCopy>{children}</TableWithCopy>; } }}>{streamingContent + '█'}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex gap-1.5"><div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></div><div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div></div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={scrollRef} />
          {showScrollButton && (
            <button onClick={() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' })} className="fixed bottom-32 right-12 z-50 p-4 bg-indigo-600 text-white rounded-full shadow-2xl hover:bg-indigo-500 border border-indigo-400 active:scale-95 flex items-center justify-center">
              <ChevronDown className="w-6 h-6" />
            </button>
          )}
        </div>

        <div className="p-8">
            <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} />
            <div className="bg-white p-2 border border-slate-200 rounded-2xl flex flex-col max-w-4xl mx-auto shadow-2xl transition-all">
                <AnimatePresence>
                  {selectedFiles.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap gap-3 p-4 border-b border-slate-100 overflow-hidden">
                      {selectedFiles.map((file, idx) => (
                        <div key={idx} className="relative group w-32 h-40 bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
                          <div className="flex-1 relative">
                            {file.mimeType.startsWith('image/') ? <img src={file.base64} alt={file.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center"><FileText size={24} className="text-indigo-600 mb-1" /><span className="text-[9px] text-slate-500 truncate w-full px-1">{file.name}</span></div>}
                            <button onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))} className="absolute top-1 right-1 p-1 bg-rose-500 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-lg z-10"><X size={12} /></button>
                          </div>
                          <div className="p-1 bg-slate-50 border-t border-slate-100">
                            <select value={file.action || 'Bahan Analisis'} onChange={(e) => { const newAction = e.target.value; setSelectedFiles(prev => prev.map((f, i) => i === idx ? { ...f, action: newAction } : f)); }} className="w-full bg-transparent text-[9px] text-indigo-600 font-bold outline-none cursor-pointer">
                              <option value="Bahan Analisis">Bahan Analisis</option><option value="Jadikan Acuan Format">Acuan Format</option><option value="Buatkan Ringkasan">Ringkasan</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex items-end gap-2">
                  <button onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-500 hover:text-indigo-600 transition-all rounded-xl hover:bg-slate-100"><Paperclip size={20} /></button>
                  <div className="flex-1 px-4 py-2">
                    <textarea ref={inputRef} value={input} rows={1} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} onPaste={handlePaste} placeholder="Say something to Nayaxa..." className="w-full bg-transparent border-none focus:outline-none text-slate-900 text-[16px] resize-none min-h-[24px] max-h-40 py-1 overflow-y-auto custom-scrollbar" />
                  </div>
                  <div className="flex items-center gap-1 p-1 mb-1">
                    <button className="p-2 text-slate-500 hover:text-indigo-600 transition-all rounded-xl hover:bg-slate-100"><Mic size={20} /></button>
                    {isTyping ? <button onClick={handleStop} className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 active:scale-90"><Square size={16} fill="currentColor" /></button> : <button onClick={handleSend} disabled={!input.trim() && selectedFiles.length === 0} className={`w-10 h-10 flex items-center justify-center rounded-xl shadow-lg ${input.trim() ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400 cursor-not-allowed'}`}><Send size={18} /></button>}
                  </div>
                </div>
            </div>
            <p className="text-center text-[10px] text-slate-500 mt-4 uppercase tracking-tighter">{codingMode ? '⚠ Coding Agent ON — Nayaxa memiliki akses baca/tulis file proyek.' : 'Nayaxa AI can make mistakes. Verify important information.'}</p>
        </div>
      </div>

      {/* Modal Masuk & Buat Akun */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-md bg-white rounded-3xl p-6 md:p-8 shadow-2xl border border-slate-100 relative"
            >
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-all"
              >
                <X size={20} />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
                  <Bot size={26} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {authMode === 'login' ? 'Masuk ke Nayaxa AI' : 'Buat Akun Baru'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {authMode === 'login' 
                      ? 'Kelola riwayat percakapan Anda' 
                      : 'Daftar akun gratis untuk menyimpan percakapan'}
                  </p>
                </div>
              </div>

              {/* Mode Toggle Tabs */}
              <div className="flex bg-slate-100 p-1 rounded-2xl mb-5">
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthError(''); }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${
                    authMode === 'login' 
                      ? 'bg-white text-indigo-600 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Masuk
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode('register'); setAuthError(''); }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${
                    authMode === 'register' 
                      ? 'bg-white text-indigo-600 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Buat Akun
                </button>
              </div>

              {authError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-600 font-medium">
                  {authError}
                </div>
              )}

              <form onSubmit={handleAuthSubmit} className="space-y-4">
                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Nama Lengkap</label>
                    <input
                      type="text"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Masukkan nama Anda"
                      className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-600"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {authMode === 'login' ? 'Nama atau Email' : 'Alamat Email'}
                  </label>
                  <input
                    type="text"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-600"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Kata Sandi</label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-600"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20 mt-2"
                >
                  {authMode === 'login' ? 'Masuk Sekarang' : 'Daftar Akun'}
                </button>
              </form>

              <div className="mt-5 text-center">
                <p className="text-xs text-slate-400">
                  Atau ingin tetap menggunakan tanpa login?{' '}
                  <button
                    type="button"
                    onClick={() => setIsAuthModalOpen(false)}
                    className="text-indigo-600 font-bold hover:underline"
                  >
                    Gunakan Mode Publik
                  </button>
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-xl backdrop-blur-md flex items-center gap-2"
          >
            <Check size={14} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
