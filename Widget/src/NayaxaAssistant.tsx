import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createNayaxaApi } from './api';
import NayaxaChart from './NayaxaChart';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from './Mermaid';
import { Send, Bot, User, Zap, X, ChevronDown, Paperclip, FileText, Image as ImageIcon } from 'lucide-react';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX';

export default function NayaxaAssistant() {
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
  
  const api = createNayaxaApi(`http://${window.location.hostname}:6001/api/nayaxa`, API_KEY); 
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    api.chatStream({
      message: msg,
      session_id: sessionId,
      user_id: 7, 
      user_name: 'Widget User',
      files: attachments
    }, (event, data) => {
      if (event === 'step') {
        setCurrentSteps(prev => [...prev, data]);
      } else if (event === 'message') {
        setCurrentResponse(prev => prev + data.text);
      } else if (event === 'thought') {
          setThought(prev => prev + data.text);
      } else if (event === 'done') {
        setMessages(prev => [...prev, { 
          role: 'model', 
          content: data.text, 
          brain_used: data.brain_used,
          steps: currentSteps,
          thought: thought,
          thinkTime: Math.round((Date.now() - (startTime || 0)) / 1000)
        }]);
        if (data.session_id) setSessionId(data.session_id);
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
        <div className="flex items-center gap-2 relative z-10">
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                <Zap size={14} className="text-yellow-300" />
            </motion.div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-7 bg-slate-50/30 custom-scrollbar">
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || ''}</ReactMarkdown>
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentResponse + '█'}</ReactMarkdown>
                </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
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
                      value={file.action || 'Bahan Analisis'}
                      onChange={(e) => {
                        const newAction = e.target.value;
                        setSelectedFiles(prev => prev.map((f, i) => i === idx ? { ...f, action: newAction } : f));
                      }}
                      className="w-full bg-transparent text-[8px] text-indigo-600 font-bold outline-none cursor-pointer"
                    >
                      <option value="Bahan Analisis">Bahan</option>
                      <option value="Jadikan Acuan Format">Format</option>
                      <option value="Buatkan Ringkasan">Ringkas</option>
                      <option value="Buatkan Ringkasan+Notulen">Notulen</option>
                      <option value="Buatkan Ringkasan+Notulen+Word">Word</option>
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
          className="flex-1 bg-slate-50/50 border border-slate-200/60 rounded-2xl py-3 px-4 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none placeholder:text-slate-400"
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
    </div>
  );
}
