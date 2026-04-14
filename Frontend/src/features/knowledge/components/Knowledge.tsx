import { useState, useEffect } from 'react';
import { Book, Plus, Search, Trash2, Edit3, ExternalLink, Filter, Database, X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createNayaxaApi } from '@/src/api';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX'; // Mock
const api = createNayaxaApi(API_KEY);

interface KnowledgeEntry {
    id?: number;
    category: string;
    content: string;
    source_file: string;
    feature_name: string;
    is_active: number;
    created_at?: string;
    updated_at?: string;
}

export default function Knowledge() {
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  
  // Form State
  const [formData, setFormData] = useState<KnowledgeEntry>({
    category: '',
    content: '',
    source_file: '',
    feature_name: 'General',
    is_active: 1
  });

  useEffect(() => { fetchKnowledge(); }, []);

  const fetchKnowledge = async () => {
    setLoading(true);
    try {
      const res = await api.getKnowledge();
      if (res.success) setKnowledge(res.data);
    } catch (err) { 
        console.error(err); 
    } finally {
        setLoading(false);
    }
  };

  const handleOpenModal = (entry: KnowledgeEntry | null = null) => {
    if (entry) {
        setEditingEntry(entry);
        setFormData({ ...entry });
    } else {
        setEditingEntry(null);
        setFormData({
            category: '',
            content: '',
            source_file: '',
            feature_name: 'General',
            is_active: 1
        });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    try {
        if (editingEntry?.id) {
            await api.updateKnowledge(editingEntry.id, formData);
        } else {
            await api.createKnowledge(formData);
        }
        setIsModalOpen(false);
        fetchKnowledge();
    } catch (err) {
        console.error('Error saving knowledge:', err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this knowledge?')) return;
    try {
        await api.deleteKnowledge(id);
        fetchKnowledge();
    } catch (err) {
        console.error('Error deleting knowledge:', err);
    }
  };

  const filteredKnowledge = knowledge.filter(k => 
    k.content?.toLowerCase().includes(search.toLowerCase()) || 
    k.category?.toLowerCase().includes(search.toLowerCase()) ||
    k.source_file?.toLowerCase().includes(search.toLowerCase())
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
        <button className="btn-primary" onClick={() => handleOpenModal()}>
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
           {[1,2,3,4,5,6].map(i => <div key={i} className="h-48 bg-slate-100 rounded-3xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredKnowledge.map((k, i) => (
            <motion.div 
              key={k.id || i}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card p-6 flex flex-col group relative overflow-hidden"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg">
                  {k.category || 'General'}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleOpenModal(k)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button 
                    onClick={() => k.id && handleDelete(k.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-700 line-clamp-4 leading-relaxed mb-6">
                {k.content}
              </p>
              <div className="mt-auto pt-4 border-t border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <Book size={12} />
                  <span>Modified {new Date(k.updated_at || k.created_at || '').toLocaleDateString()}</span>
                </div>
                {k.source_file && (
                    <button title={k.source_file} className="text-indigo-400 hover:text-indigo-600">
                        <ExternalLink size={14} />
                    </button>
                )}
              </div>
            </motion.div>
          ))}
          {filteredKnowledge.length === 0 && (
            <div className="col-span-full py-20 text-center space-y-4">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 mx-auto">
                    <Search size={32} />
                </div>
                <p className="text-slate-500">No knowledge entries found matching your search.</p>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsModalOpen(false)}
                    className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                />
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                >
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            {editingEntry ? <Edit3 size={20} className="text-indigo-600" /> : <Plus size={20} className="text-indigo-600" />}
                            {editingEntry ? 'Edit Knowledge' : 'Add New Knowledge'}
                        </h2>
                        <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-all">
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Category</label>
                                <input 
                                    type="text" 
                                    placeholder="e.g. Rules, Procedures, Facts"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/50 transition-all"
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Source File</label>
                                <input 
                                    type="text" 
                                    placeholder="e.g. handbook_2024.pdf"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/50 transition-all"
                                    value={formData.source_file}
                                    onChange={(e) => setFormData({ ...formData, source_file: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Feature Name</label>
                            <input 
                                type="text" 
                                placeholder="e.g. General, Dashboard, Profile"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/50 transition-all"
                                value={formData.feature_name}
                                onChange={(e) => setFormData({ ...formData, feature_name: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Content</label>
                            <textarea 
                                placeholder="Enter the knowledge content here..."
                                rows={8}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/50 transition-all resize-none"
                                value={formData.content}
                                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-3">
                        <button 
                            onClick={() => setIsModalOpen(false)}
                            className="px-6 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-all"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSave}
                            className="btn-primary"
                        >
                            <Save size={18} />
                            Save Knowledge
                        </button>
                    </div>
                </motion.div>
            </div>
        )}
      </AnimatePresence>
    </div>
  );
}
