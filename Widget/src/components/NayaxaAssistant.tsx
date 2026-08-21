import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createNayaxaApi } from '@/src/api';
import NayaxaChart from '@/src/components/NayaxaChart';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from '@/src/components/Mermaid';
import { Send, Bot, User, Zap, X, ChevronDown, Paperclip, FileText, Image as ImageIcon, History, Plus, Trash2, ArrowLeft, MessageSquare } from 'lucide-react';
import * as XLSX from 'xlsx';

interface NayaxaAssistantProps {
  baseUrl?: string;
  apiKey?: string;
  user?: any;
  title?: string;
  subtitle?: string;
}

export default function NayaxaAssistant({ 
  baseUrl, 
  apiKey = 'NAYAXA-BAPPERIDA-8888-9999-XXXX',
  user,
  title,
  subtitle
}: NayaxaAssistantProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSteps, setCurrentSteps] = useState<any[]>([]);
  const [thought, setThought] = useState('');
  const [currentResponse, setCurrentResponse] = useState('');
  const [showThought, setShowThought] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [thinkTime, setThinkTime] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<{ base64: string, mimeType: string, name: string, action?: string }[]>([]);
  
  const api = createNayaxaApi(
    baseUrl || (window.location.hostname === 'localhost' 
      ? `http://localhost:6001` 
      : `https://api-nayaxa.bapperida-ppm.my.id`), 
    apiKey
  ); 
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [widgetPrompts, setWidgetPrompts] = useState<{ label: string, prompt: string }[]>([]);

  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);

  const fetchSessions = () => {
    const userId = user?.id || 7;
    api.getSessions(userId).then(res => {
      if (res && res.success) {
        setSessions(res.sessions || []);
      }
    }).catch(err => {
      console.error("Gagal mengambil riwayat sesi:", err);
    });
  };

  useEffect(() => {
    fetchSessions();
  }, [user?.id]);

  const handleSelectSession = async (sessId: string) => {
    setIsTyping(true);
    setShowHistory(false);
    try {
      const res = await api.getHistoryBySession(sessId);
      if (res && res.success) {
        setSessionId(sessId);
        const mappedMessages = (res.history || []).map((h: any) => ({
          role: h.role === 'model' || h.role === 'assistant' ? 'model' : 'user',
          content: h.content,
          brain_used: h.brain_used || 'Gemini',
          thought: h.thought || '',
          thinkTime: h.think_time || 0
        }));
        setMessages(mappedMessages);
      }
    } catch (e) {
      console.error("Gagal memuat riwayat sesi:", e);
    } finally {
      setIsTyping(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessId: string) => {
    e.stopPropagation();
    if (!window.confirm("Apakah Anda yakin ingin menghapus obrolan ini?")) return;
    try {
      const res = await api.deleteSession(sessId);
      if (res && res.success) {
        fetchSessions();
        if (sessionId === sessId) {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Gagal menghapus sesi:", err);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setSessionId(null);
    setShowHistory(false);
  };

  // Excel Preview States
  const [excelPreviewOpen, setExcelPreviewOpen] = useState(false);
  const [excelPreviewLoading, setExcelPreviewLoading] = useState(false);
  const [excelPreviewFilename, setExcelPreviewFilename] = useState('');
  const [excelPreviewUrl, setExcelPreviewUrl] = useState('');
  const [previewExcelSheets, setPreviewExcelSheets] = useState<string[]>([]);
  const [activeSheetName, setActiveSheetName] = useState('');
  const [previewExcelData, setPreviewExcelData] = useState<any[]>([]);
  const workbookRef = useRef<any>(null);

  const handleExcelPreview = async (url: string) => {
    setExcelPreviewFilename(url.split('/').pop()?.split('?')[0] || 'Laporan.xlsx');
    setExcelPreviewUrl(url);
    setExcelPreviewOpen(true);
    setExcelPreviewLoading(true);
    
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      workbookRef.current = workbook;
      
      setPreviewExcelSheets(workbook.SheetNames);
      const firstSheet = workbook.SheetNames[0];
      setActiveSheetName(firstSheet);
      
      const worksheet = workbook.Sheets[firstSheet];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      setPreviewExcelData(jsonData);
      
      setExcelPreviewLoading(false);
    } catch (err) {
      console.error("Gagal memuat preview Excel:", err);
      setExcelPreviewLoading(false);
      // Fallback: download directly
      window.open(url, '_blank');
    }
  };

  const handleSheetChange = (sheetName: string) => {
    if (!workbookRef.current) return;
    setActiveSheetName(sheetName);
    const worksheet = workbookRef.current.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    setPreviewExcelData(jsonData);
  };

  useEffect(() => {
    api.getWidgetPrompts().then(res => {
      if (res && res.success) {
        setWidgetPrompts(res.data || []);
      }
    }).catch(err => console.error(err));
  }, []);

  // Timer for "Thought for X seconds"
  useEffect(() => {
    let interval: any;
    if (isTyping && startTime) {
      interval = setInterval(() => {
        setThinkTime(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTyping, startTime]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, currentSteps, currentResponse]);

  const processFiles = (files: File[]) => {
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        setSelectedFiles(prev => [...prev, { base64, mimeType: file.type, name: file.name, action: 'Bahan Analisis' }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
    if (e.target) e.target.value = ''; // Reset input
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const files = items
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
    
    if (files.length > 0) {
      processFiles(files);
    }
  };

  const handleSend = async () => {
    if ((!inputVal.trim() && selectedFiles.length === 0) || isTyping) return;
    
    // Combine file actions into instructions
    let fileInstructions = "";
    selectedFiles.forEach(f => {
      if (f.action && f.action !== 'Bahan Analisis') {
        fileInstructions += `[FILE: ${f.name} -> ACTION: ${f.action}]\n`;
      }
    });

    const msg = fileInstructions ? `${fileInstructions}\n${inputVal}` : inputVal;
    const attachments = [...selectedFiles];
    
    setInputVal('');
    setSelectedFiles([]);
    setMessages(prev => [...prev, { role: 'user', content: inputVal || (attachments.length > 0 ? "*(Mengirimkan lampiran)*" : "") }]);
    
    setIsTyping(true);
    setCurrentSteps([]);
    setThought('');
    setCurrentResponse('');
    setStartTime(Date.now());
    setThinkTime(0);
    setShowThought(true);

    // Base URL configuration for API calls
    const baseUrl = window.location.hostname === 'localhost' 
      ? 'http://localhost:6001' 
      : 'https://api-nayaxa.bapperida-ppm.my.id';

    const fixLocalhostLinks = (text: string) => {
      if (!text || window.location.hostname === 'localhost') return text;
      
      let cleaned = text;
      // Ganti semua yang pakai localhost atau domain:6001 menjadi subdomain resmi
      cleaned = cleaned.replace(/(https?:\/\/)?localhost(:\d+)?/g, 'https://api-nayaxa.bapperida-ppm.my.id');
      
      // Juga tangkap jika ada IP 127.0.0.1
      cleaned = cleaned.replace(/(https?:\/\/)?127\.0\.0\.1(:\d+)?/g, 'https://api-nayaxa.bapperida-ppm.my.id');
      
      // Ganti bapperida-ppm.my.id:6001 dengan subdomain resmi untuk mencegah SSL error
      cleaned = cleaned.replace(/(https?:\/\/)?bapperida-ppm\.my\.id:6001/g, 'https://api-nayaxa.bapperida-ppm.my.id');
      
      return cleaned;
    };    const offset = -new Date().getTimezoneOffset() / 60;
    let tzSuffix = 'WIB';
    if (offset === 8) tzSuffix = 'WITA';
    else if (offset === 9) tzSuffix = 'WIT';
    else if (offset > 0) tzSuffix = `GMT+${offset}`;
    else if (offset < 0) tzSuffix = `GMT${offset}`;

    const clientTimeFormatted = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }) + ' ' + tzSuffix;

    api.chatStream({
      message: msg,
      session_id: sessionId,
      user_id: user?.id || 7, 
      user_name: user?.nama_lengkap || user?.name || 'Widget User',
      files: attachments,
      client_time: clientTimeFormatted
    }, (event, data) => {
      if (event === 'step') {
        setCurrentSteps(prev => [...prev, data]);
      } else if (event === 'message') {
        setCurrentResponse(prev => prev + fixLocalhostLinks(data.text));
      } else if (event === 'thought') {
          setThought(prev => prev + data.text);
      } else if (event === 'done') {
        const cleanedText = fixLocalhostLinks(data.text);
        setMessages(prev => [...prev, { 
          role: 'model', 
          content: cleanedText, 
          brain_used: data.brain_used,
          steps: currentSteps,
          thought: thought,
          thinkTime: Math.round((Date.now() - (startTime || 0)) / 1000)
        }]);
        if (data.session_id) {
          setSessionId(data.session_id);
          setTimeout(fetchSessions, 500);
        }
        setIsTyping(false);
        setCurrentSteps([]);
        setCurrentResponse('');
        setStartTime(null);
      } else if (event === 'error') {
        setMessages(prev => [...prev, { role: 'model', content: `Error: ${data.message}` }]);
        setIsTyping(false);
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-[0_20px_50px_rgba(79,70,229,0.15)] border border-slate-200/60 overflow-hidden font-sans">
      {/* Premium Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-700 p-4 text-white flex items-center justify-between shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl" />
        <div className="flex items-center gap-3 relative z-10">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
                <Bot size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
                <h3 className="font-bold text-sm leading-tight">Nayaxa Assistant</h3>
                <span className="text-[10px] text-white/70 font-medium tracking-wide">AI AGENT MODULE V4.3</span>
            </div>
        </div>
        <div className="flex items-center gap-2.5 relative z-10">
            <button 
              onClick={() => {
                setShowHistory(!showHistory);
                if (!showHistory) fetchSessions();
              }}
              className="p-1.5 hover:bg-white/20 rounded-xl text-white transition-all"
              title="Riwayat Obrolan"
            >
              <History size={16} />
            </button>
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                <Zap size={14} className="text-yellow-300" />
            </motion.div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-7 bg-slate-50/30 custom-scrollbar">
        {showHistory ? (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-slate-200/85 pb-2.5">
                <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">Riwayat Obrolan</span>
                <button
                  onClick={handleNewChat}
                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-[9px] font-black uppercase transition-all flex items-center gap-1.5 border border-indigo-100"
                >
                  <Plus size={10} /> Obrolan Baru
                </button>
              </div>

              {sessions.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center opacity-40">
                  <MessageSquare size={32} className="text-slate-400 mb-2" />
                  <h4 className="text-xs font-bold text-slate-800">Belum Ada Riwayat</h4>
                  <p className="text-[10px] text-slate-500 mt-1 max-w-[180px]">Mulailah chat baru dengan mengirimkan pesan.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                  {sessions.map((s, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectSession(s.session_id)}
                      className={`p-3 rounded-2xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 group/item ${
                        sessionId === s.session_id 
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-medium' 
                        : 'bg-white hover:bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden flex-1">
                        <MessageSquare size={16} className={sessionId === s.session_id ? 'text-indigo-600 shrink-0' : 'text-slate-400 shrink-0'} />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-xs font-bold truncate pr-2">
                            {s.title || 'Obrolan Tanpa Judul'}
                          </span>
                          <span className="text-[9px] text-slate-400 font-semibold mt-0.5">
                            {s.created_at ? new Date(s.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(e, s.session_id)}
                        className="p-1 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 opacity-0 group-hover/item:opacity-100 transition-all shrink-0"
                        title="Hapus Obrolan"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowHistory(false)}
                className="w-full mt-2 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <ArrowLeft size={12} /> Kembali ke Obrolan
              </button>
            </div>
        ) : (
          <>
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                    <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center mb-4">
                        <Bot size={32} className="text-indigo-300" />
                    </div>
                    <h4 className="text-sm font-bold text-slate-800">Bagaimana saya bisa membantu hari ini?</h4>
                    <p className="text-[11px] text-slate-500 mt-2 max-w-[200px]">Tanyakan tentang kegiatan, statistik, atau analisis database Anda.</p>
                </div>
            )}

        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[95%] p-4 rounded-2xl text-[14px] leading-relaxed ${
                m.role === 'user' 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 border-b-2 border-indigo-700/30' 
                : 'bg-white text-slate-800 border border-slate-100 shadow-sm shadow-slate-200/50'
            }`}>
              
              {/* Thought section for Model */}
              {m.role === 'model' && (m.steps?.length > 0 || m.thought) && (
                  <div className="mb-4 bg-slate-50/80 rounded-xl p-3 border border-slate-100/50">
                      <details className="group/thought">
                          <summary className="list-none cursor-pointer flex items-center gap-2 text-[10px] font-bold text-slate-400 hover:text-indigo-500 transition-colors uppercase tracking-widest">
                              <ChevronDown size={12} className="group-open/thought:rotate-180 transition-transform" />
                              PENALARAN ({m.thinkTime || 0}S)
                          </summary>
                          <div className="mt-3 space-y-3 pl-2">
                             {m.steps?.map((s: any, idx: number) => (
                                 <div key={idx} className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                                     <span className="w-6 h-6 flex items-center justify-center bg-white rounded-lg shadow-sm border border-slate-100">{s.icon || '🔍'}</span>
                                     <span>{s.label}</span>
                                 </div>
                             ))}
                             {m.thought && (
                                 <div className="text-[11px] text-slate-500 italic bg-white p-3 rounded-xl border border-slate-100/50 leading-relaxed">
                                     {m.thought}
                                 </div>
                             )}
                          </div>
                      </details>
                  </div>
              )}

              <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-headings:mb-2">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => {
                      const cleanPath = href ? href.toLowerCase().split('?')[0].split('#')[0] : '';
                      const isExcel = cleanPath.endsWith('.xlsx') || cleanPath.endsWith('.xls');
                      if (isExcel) {
                        return (
                          <a 
                            href={href} 
                            onClick={(e) => { 
                              e.preventDefault(); 
                              handleExcelPreview(href || ''); 
                            }}
                            className="text-emerald-600 hover:text-emerald-700 underline font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            {children} 📊
                          </a>
                        );
                      }
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700 underline font-semibold">
                          {children}
                        </a>
                      );
                    }
                  }}
                >
                  {typeof m.content === 'string' ? m.content.replace(/\[FILE:[\s\S]*?ACTION:[\s\S]*?\]/gi, '').trim() || (m.role === 'user' ? '*(Mengirimkan lampiran)*' : '') : m.content || ''}
                </ReactMarkdown>
              </div>
            </div>
            {m.role === 'model' && m.brain_used && (
              <div className="flex items-center gap-1.5 mt-2 ml-1">
                  <div className="w-4 h-4 rounded-full bg-teal-100 flex items-center justify-center">
                    <Zap size={8} className="text-teal-600" />
                  </div>
                  <span className="text-[9px] text-slate-400 uppercase font-black tracking-widest">Powered by {m.brain_used}</span>
              </div>
            )}
          </div>
        ))}

        {/* Real-time Thinking UI */}
        {isTyping && (
          <div className="flex flex-col items-start gap-2 animate-in fade-in duration-300">
            <div className="max-w-[95%] p-5 bg-white border border-slate-100 rounded-2xl shadow-xl shadow-slate-200/20">
                
                {/* Collapsible Thought Section */}
                <div className="mb-4">
                    <div 
                        onClick={() => setShowThought(!showThought)}
                        className="flex items-center gap-3 cursor-pointer text-[12px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors mb-3"
                    >
                        <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center">
                          <motion.div animate={{ rotate: showThought ? 180 : 0 }}>
                            <ChevronDown size={14} />
                          </motion.div>
                        </div>
                        <div className="flex-1 flex items-center justify-between">
                          <span>{thought ? 'Proses Berpikir Nayaxa' : 'Nayaxa sedang menganalisis...'}</span>
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                            {thinkTime}s
                          </span>
                        </div>
                    </div>
                    
                    <AnimatePresence mode="wait">
                        {(showThought || (!thought && currentSteps.length > 0)) && (
                            <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="space-y-3 pl-4 border-l-2 border-indigo-100/50 mb-5 mt-2">
                                    {currentSteps.map((s, idx) => (
                                        <motion.div 
                                            initial={{ x: -10, opacity: 0 }}
                                            animate={{ x: 0, opacity: 1 }}
                                            key={idx} 
                                            className="flex items-center gap-3 text-[11px] text-slate-500 font-medium"
                                        >
                                            <span className="w-6 h-6 flex items-center justify-center bg-white rounded-lg shadow-sm border border-slate-100 text-[10px]">{s.icon || '⚡'}</span>
                                            <span className="font-medium">{s.label}</span>
                                        </motion.div>
                                    ))}
                                    
                                    {thought && (
                                        <div className="flex gap-3">
                                          <div className="w-1 bg-indigo-200 rounded-full" />
                                          <div className="flex-1 text-[11px] leading-relaxed text-slate-500 font-medium italic whitespace-pre-wrap">
                                            {thought}
                                            <motion.span
                                              animate={{ opacity: [0, 1, 0] }}
                                              transition={{ duration: 0.8, repeat: Infinity }}
                                              className="inline-block w-1 h-3 ml-1 bg-indigo-400"
                                            />
                                          </div>
                                        </div>
                                    )}
                                    
                                    {!currentResponse && (
                                      <div className="flex items-center gap-2.5 text-[11px] text-indigo-400 font-bold bg-indigo-50/50 w-fit px-3 py-1.5 rounded-full border border-indigo-100/50">
                                          <Zap size={12} className="animate-pulse" />
                                          <span>SEDANG MERAMU JAWABAN TERBAIK...</span>
                                      </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="prose prose-sm prose-slate prose-p:my-1 prose-headings:mb-2 leading-relaxed text-slate-700">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => {
                          const cleanPath = href ? href.toLowerCase().split('?')[0].split('#')[0] : '';
                          const isExcel = cleanPath.endsWith('.xlsx') || cleanPath.endsWith('.xls');
                          if (isExcel) {
                            return (
                              <a 
                                href={href} 
                                onClick={(e) => { 
                                  e.preventDefault(); 
                                  handleExcelPreview(href || ''); 
                                }}
                                className="text-emerald-600 hover:text-emerald-700 underline font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                {children} 📊
                              </a>
                            );
                          }
                          return (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700 underline font-semibold">
                              {children}
                            </a>
                          );
                        }
                      }}
                    >
                      {currentResponse + '█'}
                    </ReactMarkdown>
                </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-100 flex flex-col gap-3 shadow-[0_-10px_25px_rgba(0,0,0,0.02)]">
        <input 
          type="file" 
          multiple 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
        />
        
        {/* File Previews */}
        <AnimatePresence>
          {selectedFiles.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-2 pb-2 overflow-hidden"
            >
              {selectedFiles.map((file, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative group w-24 h-32 bg-slate-50 rounded-xl border border-slate-100 overflow-hidden flex flex-col"
                >
                  <div className="flex-1 relative">
                    {file.mimeType.startsWith('image/') ? (
                      <img src={file.base64} alt={file.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-1 text-center">
                        <FileText size={16} className="text-indigo-400 mb-1" />
                        <span className="text-[7px] text-slate-400 truncate w-full px-1">{file.name}</span>
                      </div>
                    )}
                    <button 
                      onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute top-0.5 right-0.5 p-1 bg-rose-500 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all hover:scale-110 z-10"
                    >
                      <X size={8} />
                    </button>
                  </div>
                  
                  {/* Widget Action Dropdown */}
                  <div className="p-1 bg-slate-100 border-t border-slate-200">
                    <select 
                      value={file.action || (widgetPrompts[0]?.prompt || 'Analisis')}
                      onChange={(e) => {
                        const newAction = e.target.value;
                        setSelectedFiles(prev => prev.map((f, i) => i === idx ? { ...f, action: newAction } : f));
                      }}
                      className="w-full bg-transparent text-[8px] text-indigo-600 font-bold outline-none cursor-pointer truncate"
                    >
                      {widgetPrompts.length > 0 ? widgetPrompts.map((wp, i) => (
                        <option key={i} value={wp.prompt}>{wp.label}</option>
                      )) : (
                        <>
                          <option value="Analisis">Analisis</option>
                          <option value="Jadikan Acuan Bahan">Jadikan Acuan Bahan</option>
                          <option value="Jadikan Acuan Format">Jadikan Acuan Format</option>
                          <option value="Buatkan Ringkasan">Buatkan Ringkasan</option>
                          <option value="Buatkan Ringkasan+Notulen">Ringkasan+Notulen</option>
                          <option value="Buatkan Ringkasan+Notulen+Word">Ringkasan+Notulen+Word</option>
                        </>
                      )}
                    </select>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-slate-400 hover:text-indigo-600 transition-all rounded-xl hover:bg-indigo-50"
          >
            <Paperclip size={20} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            onPaste={handlePaste}
            placeholder="Tanya Nayaxa..."
          className="flex-1 bg-slate-50/50 border border-slate-200/60 rounded-2xl py-3 px-4 text-[16px] md:text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none placeholder:text-slate-400"
        />
        <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSend} 
            disabled={(!inputVal.trim() && selectedFiles.length === 0) || isTyping}
            className="w-10 h-10 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100 flex items-center justify-center disabled:opacity-50 disabled:grayscale transition-all"
        >
          <Send size={18} />
        </motion.button>
      </div>

      {/* Beautiful Excel Preview Modal */}
      <AnimatePresence>
        {excelPreviewOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl h-[80vh] rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 text-white flex items-center justify-between shadow-md">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
                    <FileText size={20} className="text-white" />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="font-bold text-sm leading-tight truncate max-w-md">{excelPreviewFilename}</h3>
                    <span className="text-[10px] text-white/70 font-semibold tracking-wide">PRATINJAU SPREADSHEET</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <a 
                    href={excelPreviewUrl} 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    Unduh File
                  </a>
                  <button 
                    onClick={() => { setExcelPreviewOpen(false); workbookRef.current = null; }}
                    className="p-1.5 hover:bg-white/20 rounded-lg text-white transition-all"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Tab Sheets Selector */}
              {previewExcelSheets.length > 1 && (
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-2 flex gap-2 overflow-x-auto">
                  {previewExcelSheets.map((sheet, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSheetChange(sheet)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all border ${
                        activeSheetName === sheet 
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm' 
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {sheet}
                    </button>
                  ))}
                </div>
              )}

              {/* Content Area */}
              <div className="flex-1 overflow-auto p-6 bg-slate-50">
                {excelPreviewLoading ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
                    <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-bold tracking-wider animate-pulse">MEMBACA DATA SPREADSHEET...</span>
                  </div>
                ) : previewExcelData.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                    <FileText size={48} className="text-slate-400 mb-3" />
                    <h4 className="text-sm font-bold text-slate-800">Spreadsheet Kosong</h4>
                    <p className="text-[11px] text-slate-500 mt-1">Tidak ada baris data yang terdeteksi di sheet ini.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-white shadow-sm">
                    <table className="w-full text-xs text-left border-collapse">
                      <tbody>
                        {previewExcelData.map((row: any[], rowIdx: number) => (
                          <tr 
                            key={rowIdx} 
                            className={`${
                              rowIdx === 0 
                              ? 'bg-slate-100 font-bold border-b border-slate-200 text-slate-700 sticky top-0 z-10' 
                              : 'border-b border-slate-100 hover:bg-slate-50/50 text-slate-600'
                            }`}
                          >
                            {/* Row Index Indicator */}
                            <td className="bg-slate-50/80 text-slate-400 font-mono font-medium text-center border-r border-slate-200 w-10 py-2.5">
                              {rowIdx + 1}
                            </td>
                            {row.map((cell: any, cellIdx: number) => (
                              <td 
                                key={cellIdx} 
                                className="px-4 py-2.5 border-r border-slate-100 max-w-xs truncate"
                                title={cell?.toString() || ''}
                              >
                                {cell?.toString() || ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </div>
  );
}
