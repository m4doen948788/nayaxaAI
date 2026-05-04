import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, BookOpen, User, Settings, Bot, Menu, X, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Feature Components (Absolute Paths)
import Dashboard from '@/src/features/dashboard/components/Dashboard';
import Chat from '@/src/features/chat/components/Chat';
import Knowledge from '@/src/features/knowledge/components/Knowledge';
import Profile from '@/src/features/user/components/Profile';
import UsageStats from '@/src/features/usage/components/UsageStats';

import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';

function AppContent() {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const { currentUser } = useAuth();

  return (
    <Router>
      <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-outfit text-slate-900">
        {/* Sidebar */}
        <motion.aside 
          initial={false}
          animate={{ width: isSidebarOpen ? 280 : 80 }}
          className="relative h-full bg-white border-r border-slate-200 flex flex-col z-50 shadow-xl shadow-slate-200/50"
        >
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-600/30">
                <Bot className="text-white" size={24} />
              </div>
              {isSidebarOpen && (
                <motion.span 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="font-bold text-xl tracking-tight text-slate-900 whitespace-nowrap"
                >
                  Nayaxa <span className="text-indigo-600">AI</span>
                </motion.span>
              )}
            </div>
          </div>

          <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
            <SidebarLink to="/dashboard" icon={<LayoutDashboard size={20} />} label="Overview" isOpen={isSidebarOpen} />
            <SidebarLink to="/chat" icon={<MessageSquare size={20} />} label="Omni Chat" isOpen={isSidebarOpen} />
            <SidebarLink to="/knowledge" icon={<BookOpen size={20} />} label="Knowledge" isOpen={isSidebarOpen} />
            <SidebarLink to="/usage" icon={<BarChart3 size={20} />} label="Usage Stats" isOpen={isSidebarOpen} />
            <SidebarLink to="/profile" icon={<User size={20} />} label="My Persona" isOpen={isSidebarOpen} />
          </nav>

          <div className="p-4 mt-auto border-t border-slate-100 space-y-4">
             {/* Account Badge */}
             <div className={`flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 transition-all ${!isSidebarOpen ? 'justify-center px-0' : ''}`}>
               <div className="w-10  h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold shrink-0 shadow-lg">
                  {currentUser?.avatar || currentUser?.name[0].toUpperCase() || 'U'}
               </div>
               {isSidebarOpen && (
                 <div className="overflow-hidden">
                   <p className="text-sm font-bold text-slate-900 truncate">{currentUser?.name || 'Loading...'}</p>
                   <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider truncate">{currentUser?.role || 'User'}</p>
                 </div>
               )}
             </div>

             <SidebarLink to="/settings" icon={<Settings size={20} />} label="Settings" isOpen={isSidebarOpen} />
             <button 
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="w-full mt-4 p-3 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-400 hover:text-indigo-600 transition-all"
             >
                {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
             </button>
          </div>
        </motion.aside>

        {/* Main Content */}
        <main className="flex-1 relative overflow-hidden bg-slate-50">
          {/* Background Blobs for Aesthetics */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />
          
          <div className="relative h-full">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/usage" element={<UsageStats />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<div>Settings Page</div>} />
            </Routes>
          </div>
        </main>
      </div>
    </Router>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function SidebarLink({ to, icon, label, isOpen }: { to: string, icon: React.ReactNode, label: string, isOpen: boolean }) {
  return (
    <NavLink 
      to={to} 
      className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
    >
      <div className="shrink-0">{icon}</div>
      {isOpen && (
        <motion.span 
          initial={{ opacity: 0, x: -10 }} 
          animate={{ opacity: 1, x: 0 }}
          className="font-medium whitespace-nowrap"
        >
          {label}
        </motion.span>
      )}
    </NavLink>
  );
}

export default App;
