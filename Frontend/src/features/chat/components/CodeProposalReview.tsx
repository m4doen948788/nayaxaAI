import { useState, useEffect } from 'react';
import { FileCode, Check, X, ArrowLeft, Loader2, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CodeProposalReviewProps {
  proposalId: string;
  api: any;
}

export default function CodeProposalReview({ proposalId, api }: CodeProposalReviewProps) {
  const [proposal, setProposal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'pending' | 'accepted' | 'rejected' | 'processing'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProposal();
  }, [proposalId]);

  const fetchProposal = async () => {
    setLoading(true);
    try {
      const res = await api.getProposal(proposalId);
      if (res.success) {
        setProposal(res.proposal);
        setStatus(res.proposal.status);
      } else {
        setError('Gagal memuat proposal.');
      }
    } catch (err) {
      setError('Koneksi ke backend gagal.');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    setStatus('processing');
    try {
      const res = await api.applyProposal(proposalId);
      if (res.success) {
        setStatus('accepted');
      } else {
        setError('Gagal menerapkan perubahan.');
        setStatus('pending');
      }
    } catch (err) {
      setError('Error saat menerapkan perubahan.');
      setStatus('pending');
    }
  };

  const handleReject = async () => {
    try {
      await api.rejectProposal(proposalId);
      setStatus('rejected');
    } catch (err) {
      setError('Gagal menolak proposal.');
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-center min-h-[100px]">
        <Loader2 className="animate-spin text-indigo-600" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-4 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!proposal) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl max-w-full my-4"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between text-slate-500 bg-slate-50/50">
        <div className="flex items-center gap-2">
            <ArrowLeft size={16} className="cursor-pointer hover:text-indigo-600" />
            <FileText size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">{proposal.files.length} Files Modified</span>
        </div>
      </div>

      {/* File List */}
      <div className="p-2 space-y-1">
        {proposal.files.map((file: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-all group border border-transparent hover:border-slate-100">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
                <div className="w-2 h-2 rounded-full bg-orange-500 shadow-lg shadow-orange-600/30" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-bold text-slate-900 truncate">{file.name}</span>
                <span className="text-[10px] text-slate-400 truncate font-mono font-medium">...{file.path.slice(-30)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4 font-mono text-[11px] font-bold">
              {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-rose-500">-{file.deletions}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Footer / Actions */}
      <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-end gap-3">
        {status === 'pending' && (
          <>
            <button 
              onClick={handleReject}
              className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-rose-400 transition-all"
            >
              Reject all
            </button>
            <button 
              onClick={handleAccept}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2"
            >
              Accept all
            </button>
          </>
        )}

        {status === 'processing' && (
          <div className="flex items-center gap-2 text-indigo-400 text-sm font-bold animate-pulse">
            <Loader2 size={16} className="animate-spin" />
            Applying changes...
          </div>
        )}

        {status === 'accepted' && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold">
            <Check size={18} />
            Changes Applied
          </div>
        )}

        {status === 'rejected' && (
          <div className="flex items-center gap-2 text-rose-400 text-sm font-bold">
            <X size={18} />
            Proposal Rejected
          </div>
        )}
      </div>
    </motion.div>
  );
}
