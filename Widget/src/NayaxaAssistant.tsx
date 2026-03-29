import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bot, X, Send, FileText, Plus, Trash2, FileArchive, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createNayaxaApi } from './api';
import NayaxaChart from './NayaxaChart';

interface NayaxaWidgetProps {
  baseUrl: string;
  apiKey: string;
  user: {
    id: number;
    nama_lengkap: string;
    instansi_id?: number;
    profil_pegawai_id?: number;
  };
  title?: string;
  subtitle?: string;
}

export default function NayaxaAssistant({ 
  baseUrl, 
  apiKey, 
  user,
  title = "Nayaxa AI",
  subtitle = "Asisten Cerdas Kamu"
}: NayaxaWidgetProps) {
  
  const api = useMemo(() => createNayaxaApi(baseUrl, apiKey), [baseUrl, apiKey]);

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  
  const [messages, setMessages] = useState<{
    role: 'user' | 'assistant', 
    text: string, 
    file?: { name: string, url?: string | null, type: string },
    brainUsed?: string,
    created_at?: string
  }[]>([
    { role: 'assistant', text: 'Hai, selamat datang, saya Nayaxa asisten Anda, ada yang bisa saya bantu hari ini?' }
  ]);
  
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lastBrainUsed, setLastBrainUsed] = useState<string | null>(null);
  const [thinkingBrain, setThinkingBrain] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileMimeType, setFileMimeType] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  const fetchSessions = async () => {
    if (!user?.id) return;
    try {
      const res = await api.getSessions(user.id);
      if (res.success) setSessions(res.sessions || []);
    } catch (err) { console.error(err); }
  };

  const loadSession = async (sid: string) => {
    try {
      const res = await api.getHistoryBySession(sid);
      if (res.success) {
        setMessages(res.history.map((h: any) => ({
          role: h.role,
          text: h.content,
          brainUsed: h.brain_used,
          created_at: h.created_at
        })));
        setSessionId(sid);
        setShowHistory(false);
      }
    } catch (err) { console.error(err); }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    if (!window.confirm('Hapus percakapan ini?')) return;
    try {
      const res = await api.deleteSession(sid);
      if (res.success) {
        setSessions(prev => prev.filter(s => s.session_id !== sid));
        if (sessionId === sid) startNewChat();
      }
    } catch (err) { console.error(err); }
  };

  const startNewChat = () => {
    setMessages([{ role: 'assistant', text: `Hai, selamat datang, saya Nayaxa asisten Anda, ada yang bisa saya bantu hari ini?` }]);
    setSessionId(null);
    setLastBrainUsed(null);
    setShowHistory(false);
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputVal.trim() && !selectedFile) || isTyping) return;

    const userMsg = inputVal;
    const file = selectedFile;
    const mime = fileMimeType;
    const name = fileName;

    setInputVal('');
    setSelectedFile(null);
    setMessages(prev => [...prev, { role: 'user', text: userMsg, file: file ? { name: name!, url: file, type: mime! } : undefined }]);
    
    setIsTyping(true);
    setThinkingBrain(file ? 'Gemini' : 'DeepSeek');

    try {
      const res = await api.chat({
        message: userMsg,
        fileBase64: file || undefined,
        fileMimeType: mime || undefined,
        user_id: user.id,
        user_name: user.nama_lengkap,
        instansi_id: user.instansi_id,
        profil_id: user.profil_pegawai_id,
        session_id: sessionId,
        current_page: window.location.pathname
      });

      if (res.success) {
        setMessages(prev => [...prev, { role: 'assistant', text: res.text, brainUsed: res.brain_used }]);
        setLastBrainUsed(res.brain_used);
        setSessionId(res.session_id);
        fetchSessions();
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Maaf, gagal terhubung ke server Nayaxa.' }]);
    } finally {
      setIsTyping(false);
      setThinkingBrain(null);
    }
  };

  const handleFile = (file: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return alert('File terlalu besar (max 10MB)');
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedFile(reader.result as string);
      setFileMimeType(file.type);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  return (
    <div className="nayaxa-widget font-sans">
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform z-[9999]"
          >
            <Bot size={32} />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
            ref={panelRef}
            className={`fixed bottom-6 right-6 bg-white border w-[400px] max-w-[calc(100vw-48px)] rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all z-[9999] ${isMinimized ? 'h-16' : 'h-[580px] max-h-[calc(100vh-120px)]'}`}
          >
            <div className="bg-indigo-600 p-4 flex items-center justify-between text-white cursor-pointer" onClick={() => setIsMinimized(!isMinimized)}>
              <div className="flex items-center gap-3">
                <Bot size={20} />
                <div>
                  <h3 className="text-sm font-bold">{title}</h3>
                  <p className="text-[10px] opacity-80">{subtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); }} className="p-1.5 hover:bg-white/10 rounded-lg"><FileText size={16} /></button>
                <button onClick={(e) => { e.stopPropagation(); startNewChat(); }} className="p-1.5 hover:bg-white/10 rounded-lg"><Plus size={16} /></button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button className="p-1.5 hover:bg-white/10 rounded-lg"><ChevronUp size={16} className={`transition-transform ${isMinimized ? 'rotate-180' : ''}`} /></button>
                <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} className="p-1.5 hover:bg-white/10 rounded-lg"><X size={16} /></button>
              </div>
            </div>

            {!isMinimized && (
              <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden relative">


                <div 
                  className="flex-1 overflow-y-auto p-4 space-y-4 relative"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <AnimatePresence>
                    {isDragging && (
                      <motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[30] bg-indigo-600/10 border-2 border-dashed border-indigo-600 rounded-xl m-2 flex flex-col items-center justify-center text-indigo-600 pointer-events-none"
                      >
                        <div className="bg-white p-4 rounded-2xl shadow-lg flex flex-col items-center gap-2">
                           <Plus size={32} className="animate-bounce" />
                           <span className="text-sm font-bold">Lepaskan file untuk unggah</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-3 rounded-2xl text-[13px] ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-100' : 'bg-white border rounded-tl-none shadow-sm'}`}>
                        {m.file && (
                           <div className="mb-2">
                             {m.file.type.startsWith('image/') ? (
                               <img src={m.file.url!} alt="Attachment" className="max-w-full rounded-lg border" />
                             ) : (
                               <div className="bg-slate-50 border p-2 rounded-lg flex items-center gap-2">
                                 <FileArchive size={16} className="text-indigo-600" />
                                 <span className="text-[10px] font-bold truncate">{m.file.name}</span>
                               </div>
                             )}
                           </div>
                        )}
                        <div className="whitespace-pre-wrap leading-relaxed">
                          {(() => {
                            const CHART_REGEX = /\[NAYAXA_CHART\](.*?)\[\/NAYAXA_CHART\]/gs;
                            const segments: any[] = [];
                            let lastIdx = 0;
                            let chartMatch;

                            while ((chartMatch = CHART_REGEX.exec(m.text)) !== null) {
                              if (chartMatch.index > lastIdx) {
                                const textBefore = m.text.substring(lastIdx, chartMatch.index).trim();
                                if (textBefore) segments.push(<span key={`t-${lastIdx}`}>{textBefore}</span>);
                              }
                              try {
                                let rawSpec = chartMatch[1].trim();
                                if (rawSpec.startsWith('```')) {
                                  rawSpec = rawSpec.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
                                }
                                let chartSpec;
                                try { chartSpec = JSON.parse(atob(rawSpec)); } catch { chartSpec = JSON.parse(rawSpec); }
                                segments.push(<NayaxaChart key={`c-${chartMatch.index}`} spec={chartSpec} />);
                              } catch (err) { console.error('Chart Parse Error:', err); }
                              lastIdx = CHART_REGEX.lastIndex;
                            }
                            if (lastIdx < m.text.length) {
                              const remaining = m.text.substring(lastIdx).trim();
                              if (remaining) segments.push(<span key={`t-end`}>{remaining}</span>);
                            }
                            return segments.length > 0 ? segments : m.text;
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div className="flex gap-1.5 p-3 bg-white border rounded-2xl rounded-tl-none w-max shadow-sm">
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <AnimatePresence>
                  {showHistory && (
                    <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} className="absolute inset-0 bg-white z-20 flex flex-col border-r">
                      <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
                        <span className="font-bold text-sm">Riwayat Percakapan</span>
                        <button onClick={() => setShowHistory(false)}><X size={18} /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {sessions.map((sess, i) => (
                          <div key={i} onClick={() => loadSession(sess.session_id)} className={`p-3 rounded-xl border cursor-pointer hover:bg-slate-50 relative group ${sessionId === sess.session_id ? 'bg-indigo-50 border-indigo-200' : ''}`}>
                            <div className="text-[11px] font-bold truncate pr-6">{sess.title || 'Percakapan Lama'}</div>
                            <div className="text-[9px] text-slate-400">{new Date(sess.last_msg).toLocaleString()}</div>
                            <button onClick={(e) => handleDeleteSession(e, sess.session_id)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>
                      <div className="p-3 border-t">
                        <button onClick={startNewChat} className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">Mulai Sesi Baru</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="p-3 bg-white border-t">
                  {selectedFile && (
                    <div className="mb-2 relative inline-block">
                      {fileMimeType?.startsWith('image/') ? (
                        <img src={selectedFile} alt="Preview" className="h-12 w-12 object-cover rounded-lg border shadow-sm" />
                      ) : (
                        <div className="h-12 w-24 bg-indigo-50 rounded-lg border flex items-center justify-center p-1 overflow-hidden">
                          <span className="text-[8px] font-bold truncate text-indigo-700">{fileName}</span>
                        </div>
                      )}
                      <button onClick={() => setSelectedFile(null)} className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-0.5 shadow-md"><X size={10} /></button>
                    </div>
                  )}
                  <form onSubmit={handleSend} className="flex gap-2 items-center">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-indigo-600"><Plus size={20} /></button>
                    <div className="relative flex-1">
                      <input 
                        value={inputVal} onChange={e => setInputVal(e.target.value)} 
                        className="w-full bg-slate-50 border rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-indigo-500" 
                        placeholder="Tanya Nayaxa..." 
                        disabled={isTyping}
                      />
                      <button type="submit" disabled={!inputVal.trim() && !selectedFile} className="absolute right-1.5 top-1.5 p-1 bg-indigo-600 text-white rounded-lg disabled:opacity-50"><Send size={14} /></button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
