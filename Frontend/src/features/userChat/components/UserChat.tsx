import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Search, User, ArrowLeft, Check, CheckCheck, 
  MessageSquare, ShieldCheck, Lock, LogIn, RefreshCw,
  Sparkles, Bot, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createNayaxaApi } from '@/src/api';
import { useAuth } from '@/src/contexts/AuthContext';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX';
const api = createNayaxaApi(API_KEY);

interface Contact {
  id: number;
  username: string;
  name: string;
  email?: string | null;
  nip?: string | null;
  avatar?: string | null;
  bidang?: string | null;
  role?: string;
  unread_count: number;
  last_message?: string | null;
  last_message_at?: string | null;
}

interface Message {
  id: number;
  sender_id: number;
  recipient_id: number;
  message: string;
  file_url?: string | null;
  file_name?: string | null;
  is_read: number;
  created_at: string;
}

interface UserChatProps {
  onSwitchToAi?: () => void;
  onOpenAuth?: (mode: 'login' | 'register') => void;
}

export default function UserChat({ onSwitchToAi, onOpenAuth }: UserChatProps) {
  const { currentUser } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<any>(null);
  const contactsPollTimerRef = useRef<any>(null);

  // Scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Fetch contacts
  const fetchContacts = async (showLoading = false) => {
    if (!currentUser?.id) return;
    if (showLoading) setLoadingContacts(true);
    try {
      const res = await api.getUserChatContacts(currentUser.id, searchQuery);
      if (res.success && Array.isArray(res.contacts)) {
        setContacts(res.contacts);
        setFilteredContacts(res.contacts);
      }
    } catch (err) {
      console.error('[UserChat] Error fetching contacts:', err);
    } finally {
      if (showLoading) setLoadingContacts(false);
    }
  };

  // Fetch messages with selected peer
  const fetchMessages = async (peerId: number, isInitial = false) => {
    if (!currentUser?.id) return;
    if (isInitial) setLoadingMessages(true);
    try {
      const res = await api.getUserChatMessages(currentUser.id, peerId);
      if (res.success && Array.isArray(res.messages)) {
        setMessages(res.messages);
        if (isInitial) {
          setTimeout(() => scrollToBottom('auto'), 100);
        }
      }
    } catch (err) {
      console.error('[UserChat] Error fetching messages:', err);
    } finally {
      if (isInitial) setLoadingMessages(false);
    }
  };

  // Initial contacts load
  useEffect(() => {
    if (currentUser?.id) {
      fetchContacts(true);
    }
  }, [currentUser?.id]);

  // Client-side search filtering
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredContacts(contacts);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredContacts(
        contacts.filter((c, idx) => 
          (c.last_message && c.last_message.toLowerCase().includes(q)) ||
          `lawan bicara ${idx + 1}`.includes(q)
        )
      );
    }
  }, [searchQuery, contacts]);

  // Poll contacts list every 8 seconds
  useEffect(() => {
    if (!currentUser?.id) return;
    contactsPollTimerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchContacts(false);
      }
    }, 8000);

    return () => {
      if (contactsPollTimerRef.current) clearInterval(contactsPollTimerRef.current);
    };
  }, [currentUser?.id, searchQuery]);

  // Handle selecting a contact
  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    fetchMessages(contact.id, true);

    // Optimistically clear unread count for this contact
    setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, unread_count: 0 } : c));
  };

  // Poll active conversation every 3.5 seconds
  useEffect(() => {
    if (!currentUser?.id || !selectedContact?.id) return;

    fetchMessages(selectedContact.id, true);

    pollTimerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMessages(selectedContact.id, false);
      }
    }, 3500);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [selectedContact?.id, currentUser?.id]);

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !currentUser?.id || !selectedContact?.id || sending) return;

    const messageText = inputText.trim();
    setInputText('');
    setSending(true);

    // Optimistic message
    const tempMsg: Message = {
      id: Date.now(),
      sender_id: currentUser.id,
      recipient_id: selectedContact.id,
      message: messageText,
      is_read: 0,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => scrollToBottom(), 50);

    try {
      const res = await api.sendUserChatMessage({
        sender_id: currentUser.id,
        recipient_id: selectedContact.id,
        message: messageText
      });

      if (res.success && res.message) {
        // Update contact last message in list
        setContacts(prev => prev.map(c => {
          if (c.id === selectedContact.id) {
            return {
              ...c,
              last_message: messageText,
              last_message_at: res.message.created_at
            };
          }
          return c;
        }));
        // Refetch to ensure sync
        fetchMessages(selectedContact.id, false);
      }
    } catch (err) {
      console.error('[UserChat] Error sending message:', err);
    } finally {
      setSending(false);
      setTimeout(() => scrollToBottom(), 100);
    }
  };

  const formatMessageTime = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  };

  const formatContactTime = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  };

  // --- ACCESS GUARD (Belum Login) ---
  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 bg-slate-50 text-slate-800">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-slate-200/80 text-center space-y-6"
        >
          <div className="w-20 h-20 bg-indigo-50 border border-indigo-100 rounded-3xl mx-auto flex items-center justify-center text-indigo-600 shadow-inner">
            <Lock size={36} />
          </div>

          <div>
            <span className="px-3 py-1 bg-amber-50 text-amber-600 text-xs font-bold rounded-full border border-amber-200 inline-block mb-3">
              Perlu Akun Terdaftar
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Chat Antar Pengguna
            </h2>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              Fitur obrolan langsung ini khusus bagi pengguna yang telah memiliki akun di sistem <span className="font-semibold text-slate-700">nayaxa.my.id</span>. Silakan masuk dengan akun Anda untuk terhubung dengan rekan lainnya.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <button
              onClick={() => onOpenAuth?.('login')}
              className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 text-sm"
            >
              <LogIn size={18} /> Masuk ke Akun Anda
            </button>

            <button
              onClick={() => onOpenAuth?.('register')}
              className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-all text-xs"
            >
              Belum punya akun? Daftar Baru
            </button>
          </div>

          {onSwitchToAi && (
            <div className="pt-2 border-t border-slate-100">
              <button
                onClick={onSwitchToAi}
                className="text-xs text-indigo-600 font-semibold hover:underline inline-flex items-center gap-1"
              >
                <Bot size={14} /> Tetap gunakan Asisten AI (Mode Publik)
              </button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-white overflow-hidden font-outfit">
      {/* ── LEFT PANEL: Contact List ── */}
      <div 
        className={`w-full md:w-84 lg:w-96 bg-slate-50 border-r border-slate-200 flex flex-col h-full shrink-0 ${
          selectedContact ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
                <MessageSquare size={16} />
              </div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Chat Pengguna</h1>
            </div>

            {onSwitchToAi && (
              <button
                onClick={onSwitchToAi}
                title="Beralih ke Asisten AI Nayaxa"
                className="px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <Bot size={14} />
                <span>Nayaxa AI</span>
              </button>
            )}
          </div>

          {/* Search Contacts */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari obrolan..."
              className="w-full pl-9 pr-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-600 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Contacts Stream */}
        <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
          {loadingContacts ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-11 h-11 bg-slate-200 rounded-2xl shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-slate-200 rounded w-2/3" />
                    <div className="h-2.5 bg-slate-200 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="p-8 text-center text-slate-400 space-y-2">
              <User size={32} className="mx-auto text-slate-300" />
              <p className="text-xs">Tidak ada percakapan ditemukan.</p>
            </div>
          ) : (
            filteredContacts.map((contact, index) => {
              const isSelected = selectedContact?.id === contact.id;
              const peerDisplayName = `Lawan Bicara #${index + 1}`;

              return (
                <button
                  key={contact.id}
                  onClick={() => handleSelectContact(contact)}
                  className={`w-full p-3.5 flex items-center gap-3 text-left transition-all ${
                    isSelected 
                      ? 'bg-indigo-50/80 border-l-4 border-indigo-600' 
                      : 'hover:bg-slate-100/70 bg-transparent'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-md shadow-indigo-600/10">
                      <User size={20} />
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full"></span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <p className={`text-sm truncate ${isSelected ? 'font-bold text-indigo-950' : 'font-semibold text-slate-900'}`}>
                        {peerDisplayName}
                      </p>
                      {contact.last_message_at && (
                        <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                          {formatContactTime(contact.last_message_at)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500 truncate">
                        {contact.last_message || 'Belum ada pesan'}
                      </p>
                      {contact.unread_count > 0 && (
                        <span className="shrink-0 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-full shadow-sm animate-pulse">
                          {contact.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: Active Chat Conversation ── */}
      <div 
        className={`flex-1 flex flex-col h-full bg-white relative ${
          !selectedContact ? 'hidden md:flex' : 'flex'
        }`}
      >
        {selectedContact ? (
          <>
            {/* Active Header */}
            <div className="p-3.5 md:p-4 border-b border-slate-200 bg-white/90 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedContact(null)}
                  className="p-1.5 -ml-1 rounded-xl text-slate-600 hover:bg-slate-100 md:hidden transition-all"
                >
                  <ArrowLeft size={18} />
                </button>

                <div className="relative">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-md shadow-indigo-600/15">
                    <User size={18} />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></span>
                </div>

                <div>
                  <h2 className="text-sm md:text-base font-bold text-slate-900 leading-tight">
                    Lawan Bicara
                  </h2>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span>Pengguna nayaxa.my.id</span>
                    <span>•</span>
                    <span className="text-emerald-600 font-medium">Terverifikasi</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden sm:flex items-center gap-1 text-[11px] text-emerald-600 font-semibold px-2.5 py-1 bg-emerald-50 border border-emerald-100 rounded-full">
                  <ShieldCheck size={13} /> Terverifikasi
                </span>
                <button
                  onClick={() => fetchMessages(selectedContact.id, false)}
                  title="Perbarui pesan"
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {/* Message History */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-slate-50/50 custom-scrollbar">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-3">
                  <div className="w-14 h-14 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                    <Sparkles size={24} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">Mulai Percakapan</h3>
                  <p className="text-xs text-slate-500 max-w-xs">
                    Kirim pesan pertama Anda kepada <span className="font-semibold text-slate-700">Lawan Bicara</span>.
                  </p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isMe = msg.sender_id === currentUser.id;
                  const time = formatMessageTime(msg.created_at);

                  return (
                    <motion.div
                      key={msg.id || idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                          isMe
                            ? 'bg-indigo-600 text-white rounded-br-xs'
                            : 'bg-white text-slate-900 border border-slate-200/80 rounded-bl-xs'
                        }`}
                      >
                        <div className={`text-[10px] font-bold tracking-wider mb-1 ${
                          isMe ? 'text-indigo-200 text-right' : 'text-indigo-600 text-left'
                        }`}>
                          {isMe ? 'Anda' : 'Lawan Bicara'}
                        </div>
                        <p className="whitespace-pre-wrap break-words leading-relaxed">
                          {msg.message}
                        </p>
                        <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                          isMe ? 'text-indigo-200' : 'text-slate-400'
                        }`}>
                          <span>{time}</span>
                          {isMe && (
                            msg.is_read ? (
                              <span title="Dibaca"><CheckCheck size={13} className="text-emerald-300" /></span>
                            ) : (
                              <span title="Terkirim"><Check size={13} className="text-indigo-300" /></span>
                            )
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 md:p-4 border-t border-slate-200 bg-white">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Ketik pesan untuk Lawan Bicara..."
                  className="flex-1 py-3 px-4 bg-slate-100 border border-slate-200 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-600 transition-all placeholder:text-slate-400"
                />

                <button
                  type="submit"
                  disabled={!inputText.trim() || sending}
                  className="p-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-2xl transition-all shadow-md shadow-indigo-600/20 shrink-0"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-50/40">
            <div className="w-20 h-20 bg-indigo-50 border border-indigo-100 rounded-3xl flex items-center justify-center text-indigo-600 shadow-inner mb-4">
              <MessageSquare size={36} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Pilih Rekan Kerja</h2>
            <p className="text-xs text-slate-500 max-w-sm mt-1.5 leading-relaxed">
              Pilih salah satu pengguna dari panel sebelah kiri untuk melihat percakapan atau mengirimkan pesan langsung.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
