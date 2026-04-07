import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bot, X, Send, FileText, Plus, Trash2, FileArchive, ChevronUp, Mic, MicOff } from 'lucide-react';
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
    files?: { name: string, url?: string | null, type: string }[],
    brainUsed?: string,
    created_at?: string
  }[]>([
    { role: 'assistant', text: `hi selamat datang ${user?.nama_lengkap || 'Sobat Nayaxa'}` }
  ]);
  
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lastBrainUsed, setLastBrainUsed] = useState<string | null>(null);
  const [thinkingBrain, setThinkingBrain] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<{ base64: string, mimeType: string, name: string }[]>([]);
  const selectedFilesRef = useRef<{ base64: string, mimeType: string, name: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Resizing state
  const [width, setWidth] = useState(() => {
    const savedWidth = localStorage.getItem('nayaxa_widget_width');
    return savedWidth ? parseInt(savedWidth, 10) : 400;
  });
  const [height, setHeight] = useState(() => {
    const savedHeight = localStorage.getItem('nayaxa_widget_height');
    return savedHeight ? parseInt(savedHeight, 10) : 580;
  });
  const [resizingDir, setResizingDir] = useState<'w' | 'n' | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingDir) return;
      
      if (resizingDir === 'w') {
        const newWidth = window.innerWidth - e.clientX - 24;
        if (newWidth >= 400) {
          setWidth(newWidth);
          localStorage.setItem('nayaxa_widget_width', newWidth.toString());
        }
      } else if (resizingDir === 'n') {
        // Calculate new height: current window height - mouse Y position - bottom offset (24px)
        const newHeight = window.innerHeight - e.clientY - 24;
        if (newHeight >= 580) {
          setHeight(newHeight);
          localStorage.setItem('nayaxa_widget_height', newHeight.toString());
        }
      }
    };

    const handleMouseUp = () => {
      setResizingDir(null);
      document.body.style.cursor = 'default';
    };

    if (resizingDir) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = resizingDir === 'w' ? 'w-resize' : 'n-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingDir]);

  const handleVoiceInput = () => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      alert('Browser Anda tidak mendukung fitur input suara. Coba gunakan Chrome atau Edge.');
      return;
    }

    // If already recording, stop it
    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'id-ID';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputVal(prev => (prev ? prev + ' ' + transcript : transcript));
      setTimeout(() => inputRef.current?.focus(), 100);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'aborted') {
        alert(`Gagal menangkap suara: ${event.error}. Pastikan izin mikrofon sudah diberikan.`);
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.start();
  };



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
    setMessages([{ role: 'assistant', text: `hi selamat datang ${user?.nama_lengkap || 'Sobat Nayaxa'}` }]);
    setSessionId(null);
    setLastBrainUsed(null);
    setShowHistory(false);
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputVal.trim() && selectedFiles.length === 0) || isTyping) return;

    const userMsg = inputVal;
    const attachments = [...selectedFiles];

    setInputVal('');
    setSelectedFiles([]);
    selectedFilesRef.current = [];
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      text: userMsg, 
      files: attachments.map(a => ({ name: a.name, url: a.base64, type: a.mimeType })) 
    }]);
    
    setIsTyping(true);
    const hasImage = attachments.some(a => a.mimeType.startsWith('image/'));
    setThinkingBrain(attachments.length > 0 ? (hasImage ? 'Gemini' : 'DeepSeek') : 'DeepSeek');

    try {
      const res = await api.chat({
        message: userMsg,
        files: attachments,
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

  const handleFiles = (files: File[]) => {
    if (!files || files.length === 0) return;
    
    const currentCount = selectedFilesRef.current.length;
    const remaining = 5 - currentCount;
    if (remaining <= 0) return alert('Maksimal 5 file sekaligus');

    const toProcess = files.slice(0, remaining);
    if (toProcess.length < files.length) alert('Hanya 5 file pertama yang akan diproses');

    const promises = toProcess.map(file => {
      return new Promise<{ base64: string, mimeType: string, name: string } | null>((resolve) => {
        if (file.size > 10 * 1024 * 1024) {
          alert(`${file.name} terlalu besar (max 10MB)`);
          return resolve(null);
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve({
          base64: reader.result as string,
          mimeType: file.type,
          name: file.name
        });
        reader.readAsDataURL(file);
      });
    });

    Promise.all(promises).then(results => {
      const validResults = results.filter(r => r !== null) as { base64: string, mimeType: string, name: string }[];
      if (validResults.length > 0) {
        selectedFilesRef.current = [...selectedFilesRef.current, ...validResults];
        setSelectedFiles([...selectedFilesRef.current]);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      handleFiles(Array.from(files));
    }
    e.target.value = '';
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
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
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
            initial={{ y: 100, opacity: 0 }} 
            animate={{ y: 0, opacity: 1 }} 
            exit={{ y: 100, opacity: 0 }}
            ref={panelRef}
            className={`fixed bottom-6 right-6 bg-white border max-w-[calc(100vw-48px)] rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all z-[9999] ${isMinimized ? 'h-16' : 'max-h-[calc(100vh-120px)]'}`}
            style={{ 
              width: isMinimized ? '400px' : `${width}px`,
              height: isMinimized ? '64px' : `${height}px`,
              transition: resizingDir ? 'none' : 'width 0.3s ease, height 0.3s ease'
            }}
          >
            {/* Resize Handles */}
            {!isMinimized && (
              <>
                {/* Left Edge Handle */}
                <div 
                  className="absolute left-0 top-0 w-1.5 h-full cursor-w-resize hover:bg-indigo-400/30 transition-colors z-[100]" 
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setResizingDir('w');
                  }}
                />
                {/* Top Edge Handle */}
                <div 
                  className="absolute left-0 top-0 w-full h-1.5 cursor-n-resize hover:bg-indigo-400/30 transition-colors z-[100]" 
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setResizingDir('n');
                  }}
                />
              </>
            )}
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
                        {m.files && m.files.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-2">
                              {m.files.map((file, idx) => (
                                <div key={idx} className={file.type.startsWith('image/') ? "w-20 h-20 shrink-0" : "min-w-[120px] max-w-[180px] flex-1"}>
                                  {file.type.startsWith('image/') ? (
                                    <img src={file.url!} alt="Attachment" className="w-full h-full object-cover rounded-lg border shadow-sm" />
                                  ) : (
                                    <div className="bg-slate-50 border p-2 rounded-lg flex items-center gap-2 h-full overflow-hidden">
                                      <FileArchive size={14} className="text-indigo-600 shrink-0" />
                                      <span className="text-[9px] font-bold truncate flex-1">{file.name}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                        )}
                        <div className="whitespace-pre-wrap leading-relaxed break-words overflow-hidden">
                          {(() => {
                            const CHART_REGEX = /\[NAYAXA_CHART\](.*?)\[\/NAYAXA_CHART\]/gs;
                            const segments: any[] = [];
                            let lastIdx = 0;
                            let chartMatch;

                            const renderTextSegment = (text: string, key: string) => {
                              // Strip Markdown Header hashes
                              const cleanMarkdown = text.replace(/^#+\s/gm, '').replace(/\n#+\s/g, '\n');
                              
                              const parts: (string | JSX.Element)[] = [];
                              let li = 0;
                              let lm;
                              
                              // Handle bold formatting **text** (more resilient version)
                              const boldRegex = /\*\*([\s\S]+?)\*\*(?!\*)/g;
                              
                              const processLinks = (input: string, baseKey: string) => {
                                const subParts: (string | JSX.Element)[] = [];
                                let sli = 0;
                                let slm;
                                
                                // Regex to match either Markdown link [text](url) OR raw URL http(s)://...
                                const combinedRegex = /\[([^\]]+)\]\s*\(([^)]+)\)|(https?:\/\/[^\s]+)/g;
                                
                                while ((slm = combinedRegex.exec(input)) !== null) {
                                  if (slm.index > sli) subParts.push(input.substring(sli, slm.index));
                                  
                                  const markdownText = slm[1];
                                  const markdownUrl = slm[2];
                                  const rawUrl = slm[3];
                                  
                                  const linkUrl = markdownUrl || rawUrl;
                                  const linkText = markdownText || rawUrl;
                                  
                                  const isDownload = linkUrl.includes('/uploads/exports/');
                                  
                                  subParts.push(
                                    <a 
                                      key={`${baseKey}-l-${slm.index}`} 
                                      href={linkUrl} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      download={isDownload ? `${linkText.replace(/[\[\]]/g, '')}.${linkUrl.split('.').pop()?.split(/[?#]/)[0]}` : undefined}
                                      className={`inline-flex items-center gap-2 my-1 p-2 px-3 rounded-lg border transition-all max-w-full break-all shadow-sm ${
                                        isDownload ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold underline' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 underline'
                                      }`}
                                    >
                                      {isDownload ? <FileArchive size={14} className="shrink-0" /> : <Plus size={14} className="rotate-45 shrink-0" />}
                                      <span className="truncate max-w-[140px] sm:max-w-[280px]">{linkText}</span>
                                    </a>
                                  );
                                  sli = combinedRegex.lastIndex;
                                }
                                if (sli < input.length) subParts.push(input.substring(sli));
                                return subParts;
                              };

                              while ((lm = boldRegex.exec(cleanMarkdown)) !== null) {
                                if (lm.index > li) {
                                  parts.push(...processLinks(cleanMarkdown.substring(li, lm.index), `bpre-${lm.index}`));
                                }
                                parts.push(<strong key={`b-${lm.index}`} className="font-bold">{lm[1]}</strong>);
                                li = boldRegex.lastIndex;
                              }
                              
                              if (li < cleanMarkdown.length) {
                                parts.push(...processLinks(cleanMarkdown.substring(li), `bend-${li}`));
                              }
                              
                              return <span key={key}>{parts.length > 0 ? parts : cleanMarkdown}</span>;
                            };

                            while ((chartMatch = CHART_REGEX.exec(m.text)) !== null) {
                              if (chartMatch.index > lastIdx) {
                                const textBefore = m.text.substring(lastIdx, chartMatch.index).trim();
                                if (textBefore) segments.push(renderTextSegment(textBefore, `t-${lastIdx}`));
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
                              if (remaining) segments.push(renderTextSegment(remaining, `t-end`));
                            }
                            return segments.length > 0 ? segments : (typeof m.text === 'string' ? renderTextSegment(m.text, 't-only') : m.text);
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
                  {selectedFiles.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {selectedFiles.map((file, idx) => (
                        <div key={idx} className="relative inline-block group">
                          {file.mimeType.startsWith('image/') ? (
                            <img src={file.base64} alt="Preview" className="h-12 w-12 object-cover rounded-lg border shadow-sm" />
                          ) : (
                            <div className="h-12 w-24 bg-indigo-50 rounded-lg border flex items-center justify-center p-1 overflow-hidden">
                              <span className="text-[8px] font-bold truncate text-indigo-700">{file.name}</span>
                            </div>
                          )}
                          <button 
                            type="button"
                            onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))} 
                            className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={handleSend} className="flex gap-2 items-center">
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf,.xlsx,.csv,.txt,.docx,.doc" onChange={handleFileChange} multiple />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-indigo-600"><Plus size={20} /></button>
                    <button
                      type="button"
                      onClick={handleVoiceInput}
                      title={isRecording ? 'Klik untuk berhenti merekam' : 'Klik untuk bicara'}
                      className={`p-2 rounded-lg transition-all ${
                        isRecording
                          ? 'text-white bg-red-500 animate-pulse shadow-md shadow-red-200'
                          : 'text-slate-400 hover:text-indigo-600'
                      }`}
                    >
                      {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                    <div className="relative flex-1">
                      <input 
                        value={inputVal} onChange={e => setInputVal(e.target.value)} 
                        className="w-full bg-slate-50 border rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-indigo-500" 
                        placeholder="Tanya Nayaxa (Word/Excel/PDF)..." 
                        disabled={isTyping}
                      />
                      <button type="submit" disabled={!inputVal.trim() && selectedFiles.length === 0} className="absolute right-1.5 top-1.5 p-1 bg-indigo-600 text-white rounded-lg disabled:opacity-50"><Send size={14} /></button>
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
