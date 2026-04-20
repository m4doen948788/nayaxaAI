import { User, Shield, Key, History, Mail, MapPin, Briefcase, Zap, Star, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Profile() {
  const { currentUser } = useAuth();
  
  // Enriched data for display (could eventually come from API)
  const user = {
    name: currentUser?.name || 'Loading...',
    nip: currentUser?.id === 95 ? 'SUPERADMIN_01' : '199201012023011001',
    role: currentUser?.role || 'Member',
    bidang: 'Sekretariat Utama',
    instansi: 'Pemerintah Daerah Nayaxa',
    email: currentUser?.id === 95 ? 'sammy@nayaxa.ai' : 'admin@nayaxa.go.id',
    lastLogin: new Date().toISOString().split('T')[0] + ' 08:30:12',
    persona: 'Anda adalah seorang administrator senior yang mahir dalam mengelola sistem Nayaxa AI. Fokus Anda adalah pada validitas data dan kemudahan navigasi pengguna.'
  };

  return (
    <div className="h-full overflow-y-auto p-8 space-y-8 max-w-5xl mx-auto custom-scrollbar">
      <header className="flex items-center gap-6">
        <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-4xl font-bold text-white shadow-2xl shadow-indigo-500/20">
            {user.name[0]}
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 border-4 border-slate-950 rounded-full"></div>
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{user.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="px-3 py-1 bg-indigo-600/20 text-indigo-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-indigo-600/20">
                {user.role}
            </span>
            <span className="text-slate-500 text-sm flex items-center gap-1">
                <ShieldCheck size={14} /> Verified Account
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Profile Info */}
        <div className="md:col-span-2 space-y-8">
          <section className="glass-card p-8">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <User className="text-indigo-400" size={20} /> Personal Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-12">
                <InfoItem icon={<Shield size={16}/>} label="NIP / Employee ID" value={user.nip} />
                <InfoItem icon={<Briefcase size={16}/>} label="Department" value={user.bidang} />
                <InfoItem icon={<MapPin size={16}/>} label="Institution" value={user.instansi} />
                <InfoItem icon={<Mail size={16}/>} label="Email Address" value={user.email} />
            </div>
          </section>

          {/* Persona Analysis */}
          <section className="glass-card p-8 border-indigo-500/20 bg-indigo-600/[0.02]">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Zap className="text-yellow-400" size={20} /> AI Persona Analysis
                </h2>
                <div className="flex items-center gap-1">
                    {[1,2,3,4,5].map(i => <Star key={i} size={12} className="fill-indigo-500 text-indigo-500" />)}
                </div>
            </div>
            <p className="text-slate-300 leading-relaxed italic text-sm">
                "{user.persona}"
            </p>
            <div className="mt-6 flex gap-4">
                <div className="px-4 py-2 bg-white/5 rounded-xl border border-white/10 text-[11px] text-slate-400 italic">
                    Analisis terakhir: 2 jam yang lalu
                </div>
            </div>
          </section>
        </div>

        {/* Sidebar Actions */}
        <div className="space-y-6">
             <div className="glass-card p-6">
                <h3 className="font-bold text-white mb-4">Security</h3>
                <div className="space-y-2">
                    <button className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-sm text-slate-300 transition-all border border-white/5">
                        <Key size={16} /> Manage API Keys
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-sm text-slate-300 transition-all border border-white/5">
                        <History size={16} /> Login Sessions
                    </button>
                </div>
             </div>

             <div className="glass-card p-6 bg-gradient-to-br from-indigo-600/20 to-transparent">
                <h3 className="font-bold text-white mb-2">Usage Credits</h3>
                <div className="text-2xl font-bold text-white mb-1">92.4%</div>
                <p className="text-[10px] text-slate-400 uppercase font-medium">Platform Reliability Score</p>
                <div className="w-full h-2 bg-slate-800 rounded-full mt-4 overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: '92.4%' }}></div>
                </div>
             </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
    return (
        <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                {icon} {label}
            </span>
            <p className="text-sm font-semibold text-white">{value}</p>
        </div>
    );
}
