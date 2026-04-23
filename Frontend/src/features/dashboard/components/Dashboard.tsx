import { useState, useEffect } from 'react';
import { Users, Activity, Target, Zap, TrendingUp, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { createNayaxaApi } from '@/src/api';

const API_KEY = 'nayaxa_engine_secret_key'; // In real app, get from context/storage
const api = createNayaxaApi(API_KEY);

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInsights = async () => {
      try {
        const res = await api.getDashboardInsights();
        if (res.success) setData(res.data.insights);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchInsights();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Pegawai', value: data?.stats?.total_pegawai || 0, icon: <Users />, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: 'Pegawai Aktif', value: data?.stats?.active_pegawai || 0, icon: <Activity />, color: 'text-green-400', bg: 'bg-green-400/10' },
    { label: 'Fill Rate', value: `${data?.stats?.fill_rate_percentage || 0}%`, icon: <Target />, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
    { label: 'Pertumbuhan', value: `${data?.forecast?.growth_percentage || 0}%`, icon: <TrendingUp />, color: data?.forecast?.growth_percentage >= 0 ? 'text-green-400' : 'text-red-400', bg: 'bg-emerald-400/10' },
  ];

  return (
    <div className="h-full overflow-y-auto p-8 space-y-8 max-w-7xl mx-auto custom-scrollbar">
      <header>
        <h1 className="text-3xl font-bold text-white tracking-tight">Overview Dashboard</h1>
        <p className="text-slate-400 mt-1">Selamat datang kembali. Berikut adalah rangkuman performa hari ini.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card p-6"
          >
            <div className="flex items-center justify-between">
              <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color}`}>
                {stat.icon}
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${stat.bg} ${stat.color}`}>
                Live
              </span>
            </div>
            <div className="mt-4">
              <p className="text-sm font-medium text-slate-400">{stat.label}</p>
              <h3 className="text-2xl font-bold text-white mt-1">{stat.value}</h3>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Top Performers */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Zap className="text-yellow-400" size={20} />
                Pegawai Terbaik Bulan Ini
              </h2>
              <button className="text-sm text-indigo-400 font-semibold hover:underline">Lihat Semua</button>
            </div>
            <div className="space-y-4">
              {data?.scoring?.top_pegawai?.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-sm text-white">
                      {p.nama[0]}
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">{p.nama}</h4>
                      <p className="text-[11px] text-slate-400">{p.bidang}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">{p.normalized_score} Pts</div>
                    <div className="w-24 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${p.normalized_score}%` }}></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Anomalies / Alerts */}
        <div className="space-y-6">
          <div className="glass-card p-8 border-red-500/20">
            <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-6 text-red-400">
              <AlertCircle size={20} />
              Anomali & Alerts
            </h2>
            <div className="space-y-4">
              {data?.alerts?.inactive_alerts?.slice(0, 5).map((a: any, i: number) => (
                <div key={i} className="p-4 rounded-2xl bg-red-400/5 border border-red-500/10">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-red-200 text-sm">{a.nama}</h4>
                    <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Inactive</span>
                  </div>
                  <p className="text-[11px] text-red-200/60 mt-1">{a.days_inactive} hari tanpa laporan harian</p>
                </div>
              ))}
              {(!data?.alerts?.inactive_alerts || data.alerts.inactive_alerts.length === 0) && (
                <p className="text-slate-400 text-center py-4 text-sm italic">Tidak ada anomali terdeteksi.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
