import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, Users, ChevronRight, ArrowLeft, Activity, MessageCircle, Wallet, Bot } from 'lucide-react';
import { createNayaxaApi } from '@/src/api';

const API_KEY = 'NAYAXA-BAPPERIDA-8888-9999-XXXX';
const api = createNayaxaApi(API_KEY);

export default function UsageStats() {
    const [loading, setLoading] = useState(true);
    const [apps, setApps] = useState<any[]>([]);
    const [globalDaily, setGlobalDaily] = useState<any[]>([]);
    const [selectedApp, setSelectedApp] = useState<any | null>(null);
    const [selectedUser, setSelectedUser] = useState<any | null>(null);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const res = await api.getUsageStats();
            if (res.success) {
                setApps(res.data);
                setGlobalDaily(res.global_daily || []);
            }
        } catch (err) {
            console.error(err);
        }
        setLoading(false);
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 border-4 border-indigo-600/20 border-t-indigo-500 rounded-full animate-spin" />
                    <p className="text-slate-400 font-medium animate-pulse tracking-widest text-xs uppercase">Menghitung statistik penggunaan...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 h-full overflow-y-auto custom-scrollbar relative">
            {/* Background Aesthetics */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600/[0.03] blur-[100px] rounded-full -z-10" />
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-600/[0.03] blur-[100px] rounded-full -z-10" />

            <header className="mb-10 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                        <BarChart3 className="text-indigo-600" /> Usage Analytics
                    </h1>
                    <p className="text-slate-500">Statistik penggunaan Nayaxa AI dan estimasi biaya operasional per widget/aplikasi.</p>
                </div>
                {(selectedApp || selectedUser) && (
                    <button 
                        onClick={() => {
                            if (selectedUser) {
                                setSelectedUser(null);
                            } else {
                                setSelectedApp(null);
                            }
                        }}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 transition-all font-bold text-sm shadow-sm"
                    >
                        <ArrowLeft size={18} /> Kembali
                    </button>
                )}
            </header>

            <AnimatePresence mode="wait">
                {!selectedApp ? (
                    <motion.div 
                        key="apps-grid"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="space-y-10"
                    >
                        {/* Global Trend Chart */}
                        {globalDaily.length > 0 && (
                            <section className="glass-card p-8 bg-white border-slate-200 shadow-xl overflow-hidden relative">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="font-bold text-slate-900 flex items-center gap-2 text-xl">
                                        <Activity size={22} className="text-indigo-600" /> Tren Penggunaan Global (30 Hari Terakhir)
                                    </h3>
                                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full font-black uppercase tracking-widest">Live Updates</span>
                                </div>
                                <div className="flex items-end gap-1 h-48 group/chart">
                                    {globalDaily.slice().reverse().map((day, i) => {
                                        const maxMsg = Math.max(...globalDaily.map(d => d.message_count));
                                        const height = (day.message_count / maxMsg) * 100;
                                        return (
                                            <div key={i} className="flex-1 flex flex-col items-center gap-2 group/bar relative">
                                                <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                                                    {new Date(day.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}: {day.message_count} Msg
                                                </div>
                                                <div 
                                                    style={{ height: `${Math.max(height, 5)}%` }} 
                                                    className={`w-full rounded-t-lg transition-all cursor-help ${day.date === '2026-04-27' ? 'bg-indigo-600 animate-pulse ring-4 ring-indigo-100' : 'bg-slate-200 hover:bg-indigo-400'}`}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex justify-between mt-4 px-1 text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                                    <span>{new Date(globalDaily[globalDaily.length-1].date).toLocaleDateString()}</span>
                                    <span>Hari Ini</span>
                                </div>
                            </section>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {apps.map((app) => (
                                <motion.div
                                    key={app.app_id}
                                    whileHover={{ y: -5, scale: 1.02 }}
                                    onClick={() => setSelectedApp(app)}
                                    className="glass-card p-8 border-white/5 cursor-pointer group hover:border-indigo-500/50 transition-all relative overflow-hidden"
                                >

                                <div className="absolute -top-4 -right-4 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                    <Bot size={120} />
                                </div>
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-xl shadow-indigo-600/5">
                                        <Activity size={28} />
                                    </div>
                                    <h3 className="font-bold text-2xl text-slate-900 tracking-tight">{app.app_name}</h3>
                                </div>
                                
                                <div className="space-y-5">
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-slate-500 flex items-center gap-2 font-medium"><Users size={16} /> Total Pengguna</span>
                                        <span className="text-slate-900 font-bold">{app.users.length}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-slate-500 flex items-center gap-2 font-medium"><MessageCircle size={16} /> Total Interaksi</span>
                                        <span className="text-slate-900 font-bold">{app.total_app_messages.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center border-t border-slate-100 pt-5 mt-5">
                                        <span className="text-slate-500 font-bold flex items-center gap-2"><Wallet size={18} className="text-emerald-600" /> Estimasi Biaya</span>
                                        <span className="text-emerald-600 font-black text-2xl tracking-tighter">${app.total_app_cost.toFixed(2)}</span>
                                    </div>
                                </div>
                                <div className="mt-8 flex justify-center text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all">
                                    <ChevronRight size={28} />
                                </div>
                            </motion.div>
                        ))}
                        </div>
                    </motion.div>

                ) : selectedUser ? (
                    <motion.div
                        key="user-detail"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        <div className="glass-card p-8 bg-white border-slate-200 shadow-xl overflow-hidden relative">
                             <div className="absolute top-0 right-0 p-8 opacity-5">
                                <Users size={120} />
                             </div>
                             <div className="flex items-center gap-6 mb-10">
                                 <div className="w-20 h-20 rounded-3xl bg-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-2xl shadow-indigo-600/30">
                                     {selectedUser.user_name[0]}
                                 </div>
                                 <div>
                                     <h2 className="text-3xl font-bold text-slate-900">{selectedUser.user_name}</h2>
                                     <p className="text-slate-500 flex items-center gap-2">
                                         ID Pengguna: <span className="font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-xs">#{selectedUser.user_id}</span>
                                         <span className="w-1 h-1 bg-slate-300 rounded-full" />
                                         Aplikasi: <span className="text-indigo-600 font-bold uppercase">{selectedApp.app_name}</span>
                                     </p>
                                 </div>
                             </div>

                             <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                 <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                                     <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Total Interaksi</p>
                                     <p className="text-3xl font-black text-slate-900">{selectedUser.message_count.toLocaleString()}</p>
                                 </div>
                                 <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                                     <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Total Konsumsi Token</p>
                                     <p className="text-3xl font-black text-slate-900">{selectedUser.total_tokens.toLocaleString()}</p>
                                 </div>
                                 <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
                                     <p className="text-[10px] text-emerald-600 uppercase font-black tracking-widest mb-1">Estimasi Biaya ($)</p>
                                     <p className="text-3xl font-black text-emerald-600">${selectedUser.estimated_cost.toFixed(4)}</p>
                                 </div>
                             </div>
                        </div>

                        <div className="glass-card p-0 border-slate-200 shadow-xl bg-white overflow-hidden">
                            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                                    <Activity size={18} className="text-indigo-600" /> Riwayat Penggunaan Per Tanggal
                                </h3>
                                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter italic">Data sinkronisasi otomatis dari Engine Log</div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50/80 text-[10px] uppercase font-black text-slate-500 tracking-widest border-b border-slate-100">
                                        <tr>
                                            <th className="px-8 py-4">Tanggal Penggunaan</th>
                                            <th className="px-8 py-4 text-center">Interaksi (Msg)</th>
                                            <th className="px-8 py-4 text-center">Token</th>
                                            <th className="px-8 py-4 text-right">Biaya ($)</th>
                                            <th className="px-8 py-4 text-right">Biaya (IDR)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {selectedUser.daily_usage.map((day: any) => (
                                            <tr key={day.date} className="hover:bg-indigo-50/30 transition-colors">
                                                <td className="px-8 py-5">
                                                    <span className="font-bold text-slate-900">
                                                        {new Date(day.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-5 text-center">
                                                    <span className="bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-xs font-black text-slate-700 shadow-sm">
                                                        {day.message_count}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-5 text-center text-slate-500 font-mono text-sm">
                                                    {day.total_tokens.toLocaleString()}
                                                </td>
                                                <td className="px-8 py-5 text-right font-black text-emerald-600 font-mono">
                                                    ${day.estimated_cost.toFixed(4)}
                                                </td>
                                                <td className="px-8 py-5 text-right">
                                                    <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded">
                                                        Rp {(day.estimated_cost * 16200).toLocaleString('id-ID')}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div 
                        key="user-stats"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <div className="glass-card p-0 border-slate-200 overflow-hidden shadow-2xl bg-white">
                            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-transparent">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                                        Detail Pengguna: <span className="text-indigo-600">{selectedApp.app_name}</span>
                                    </h2>
                                    <p className="text-slate-500 text-sm mt-1">Daftar penggunaan per personil. Klik baris untuk detail harian.</p>
                                </div>
                                <div className="flex gap-8">
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Total App Messages</p>
                                        <p className="text-2xl font-black text-slate-900">{selectedApp.total_app_messages.toLocaleString()}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-emerald-600 uppercase tracking-widest font-black">Total App Cost</p>
                                        <p className="text-2xl font-black text-emerald-600">${selectedApp.total_app_cost.toFixed(2)}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                                            <th className="px-8 py-5 font-black">User / Nama Lengkap</th>
                                            <th className="px-8 py-5 font-black">Interaksi</th>
                                            <th className="px-8 py-5 font-black text-center">Estimasi Token</th>
                                            <th className="px-8 py-5 font-black text-right">Estimasi Biaya ($)</th>
                                            <th className="px-8 py-5 font-black text-right">Biaya (Rupiah)*</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {selectedApp.users.map((user: any) => (
                                            <tr 
                                                key={user.user_id} 
                                                onClick={() => setSelectedUser(user)}
                                                className="hover:bg-indigo-50/50 cursor-pointer transition-all group"
                                            >
                                                <td className="px-8 py-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-11 h-11 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-indigo-600 font-black group-hover:bg-indigo-600 group-hover:text-white group-hover:scale-110 transition-all shadow-lg">
                                                            {user.user_name[0]}
                                                        </div>
                                                        <div>
                                                            <span className="font-bold text-slate-900 block text-lg group-hover:text-indigo-600 transition-colors">{user.user_name}</span>
                                                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">ID: {user.user_id}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6">
                                                    <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-black border border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                                        {user.message_count} messages
                                                    </span>
                                                </td>
                                                <td className="px-8 py-6 text-center">
                                                    <span className="text-slate-500 font-mono font-medium">{user.total_tokens.toLocaleString()}</span>
                                                </td>
                                                <td className="px-8 py-6 text-right">
                                                    <span className="text-emerald-600 font-black font-mono text-lg">${user.estimated_cost.toFixed(4)}</span>
                                                </td>
                                                <td className="px-8 py-6 text-right">
                                                    <span className="text-slate-700 font-bold text-sm bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 group-hover:border-indigo-200 transition-all">
                                                        Rp {(user.estimated_cost * 16200).toLocaleString('id-ID')}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="p-6 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 font-medium uppercase text-center tracking-widest">
                                * Estimasi Biaya dihitung berdasarkan volume karakter (1 Token ≈ 3.5 Karakter). Kurs: Rp16.200. Klik baris pengguna untuk melihat rincian harian.
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

