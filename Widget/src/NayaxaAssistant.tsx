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
  const [messages, setMessages] = useState<any[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lastBrainUsed, setLastBrainUsed] = useState<string | null>(null);
  const [thinkingBrain, setThinkingBrain] = useState<string | null>(null);
  const [proactiveInsight, setProactiveInsight] = useState<{ topic: string, insight: string } | null>(null);
  const [showInsight, setShowInsight] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileMimeType, setFileMimeType] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Proactive Insight
  useEffect(() => {
    if (!user || !isOpen) return;
    const fetchProactive = async () => {
      try {
        const res = await api.getProactiveInsight({ 
          current_page: window.location.pathname,
          instansi_id: user.instansi_id 
        });
        if (res.success && res.insight) {
          setProactiveInsight({ topic: res.topic, insight: res.insight });
          setShowInsight(true);
          setTimeout(() => setShowInsight(false), 15000);
        }
      } catch (err) { console.error('Proactive Insight Error:', err); }
    };
    fetchProactive();
  }, [window.location.pathname, user?.id, isOpen]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{ role: 'assistant', text: `Halo ${user.nama_lengkap}! Ada yang bisa saya bantu hari ini?` }]);
      fetchSessions();
    }
  }, [isOpen]);

  const fetchSessions = async () => {
    try {
      const res = await api.getSessions(user.id);
      if (res.success) setSessions(res.sessions || []);
    } catch (err) { console.error(err); }
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
    setMessages(prev => [...prev, { role: 'user', text: userMsg, file: file ? { name, url: file, type: mime! } : undefined }]);
    
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

  // ... (Remainder of the component UI login logic from original, adapted for props) ...
  // Keeping it brief for the walkthrough but full implementation should follow
  return (
    <div className="nayaxa-widget">
      {/* FAB and Panel Rendering goes here - same as original with props for colors/text */}
      <div className="fixed bottom-6 right-6 z-[9999]">
         {!isOpen ? (
            <button onClick={() => setIsOpen(true)} className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform">
               <Bot size={32} />
            </button>
         ) : (
            <div ref={panelRef} className={`bg-white border w-[400px] rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all ${isMinimized ? 'h-16' : 'h-[580px]'}`}>
                <div className="bg-indigo-600 p-4 flex items-center justify-between text-white">
                   <div className="flex items-center gap-3">
                      <Bot size={20} />
                      <div>
                        <h3 className="text-sm font-bold">{title}</h3>
                        <p className="text-[10px] opacity-80">{subtitle}</p>
                      </div>
                   </div>
                   <button onClick={() => setIsOpen(false)}><X size={20} /></button>
                </div>
                {!isMinimized && (
                   <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden relative">
                       {/* Proactive Badge */}
                       <AnimatePresence>
                        {showInsight && (
                            <div className="absolute top-2 left-4 right-4 z-10 bg-indigo-500 text-white p-2 rounded-xl text-xs flex gap-2">
                                <Bot size={14} className="mt-0.5" />
                                <span className="flex-1">{proactiveInsight?.insight}</span>
                                <button onClick={() => setShowInsight(false)}><X size={12} /></button>
                            </div>
                        )}
                       </AnimatePresence>
                       <div className="flex-1 overflow-y-auto p-4 space-y-4">
                          {messages.map((m, i) => (
                             <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] p-3 rounded-2xl text-xs ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border'}`}>
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
                                            try {
                                              chartSpec = JSON.parse(atob(rawSpec));
                                            } catch {
                                              chartSpec = JSON.parse(rawSpec);
                                            }
                                            segments.push(<NayaxaChart key={`c-${chartMatch.index}`} spec={chartSpec} />);
                                          } catch (err) {
                                            console.error('Chart Parse Error:', err);
                                          }
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
                       </div>
                       <form onSubmit={handleSend} className="p-3 bg-white border-t flex gap-2">
                          <input 
                            value={inputVal} 
                            onChange={e => setInputVal(e.target.value)} 
                            className="flex-1 bg-slate-50 text-xs p-2 rounded-xl border border-slate-200 outline-none" 
                            placeholder="Tanya Nayaxa..."
                          />
                          <button type="submit" className="p-2 bg-indigo-600 text-white rounded-xl"><Send size={16} /></button>
                       </form>
                   </div>
                )}
            </div>
         )}
      </div>
    </div>
  );
}
