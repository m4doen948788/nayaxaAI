import { useState, useEffect } from 'react';
import { Book, Plus, Search, Trash2, Edit3, ExternalLink, Filter, Database } from 'lucide-react';
import { motion } from 'framer-motion';
import { createNayaxaApi } from '@/src/api';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX'; // Mock
const api = createNayaxaApi(API_KEY);

export default function Knowledge() {
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchKnowledge(); }, []);

  const fetchKnowledge = async () => {
    setLoading(false); // Mock loading
    try {
      const res = await api.getKnowledge();
      if (res.success) setKnowledge(res.data);
    } catch (err) { console.error(err); }
  };

  const filteredKnowledge = knowledge.filter(k => 
    k.content.toLowerCase().includes(search.toLowerCase()) || 
    k.category?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full overflow-y-auto p-8 space-y-8 max-w-7xl mx-auto custom-scrollbar">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                <Database size={28} />
            </div>
            Knowledge Base
          </h1>
          <p className="text-slate-500 mt-1">Manage the documents and context used by your AI assistant.</p>
        </div>
        <button className="btn-primary">
          <Plus size={18} /> Add Knowledge
        </button>
      </header>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search knowledge by content or category..." 
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-12 pr-4 text-sm text-slate-900 focus:outline-none focus:border-indigo-500/50 transition-all shadow-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-white rounded-2xl border border-slate-200 text-slate-600 hover:text-indigo-600 transition-all text-sm shadow-sm">
          <Filter size={18} /> Filter
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {[1,2,3,4,5,6].map(i => <div key={i} className="h-48 bg-white/5 rounded-3xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredKnowledge.map((k, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card p-6 flex flex-col group"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg">
                  {k.category || 'General'}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50"><Edit3 size={14} /></button>
                  <button className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Trash2 size={14} /></button>
                </div>
              </div>
              <p className="text-sm text-slate-700 line-clamp-4 leading-relaxed mb-6">
                {k.content}
              </p>
              <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <Book size={12} />
                  <span>Modified {new Date(k.updated_at || k.created_at).toLocaleDateString()}</span>
                </div>
                {k.source_file && (
                    <button title={k.source_file} className="text-indigo-400 hover:text-indigo-300">
                        <ExternalLink size={14} />
                    </button>
                )}
              </div>
            </motion.div>
          ))}
          {filteredKnowledge.length === 0 && (
            <div className="col-span-full py-20 text-center space-y-4">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center text-slate-600 mx-auto">
                    <Search size={32} />
                </div>
                <p className="text-slate-400">No knowledge entries found matching your search.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
