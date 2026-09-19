import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Feature Components (Absolute Paths)
import Chat from '@/src/features/chat/components/Chat';
import Knowledge from '@/src/features/knowledge/components/Knowledge';
import Profile from '@/src/features/user/components/Profile';
import UsageStats from '@/src/features/usage/components/UsageStats';

import { AuthProvider } from '@/src/contexts/AuthContext';

function AppContent() {
  return (
    <Router>
      <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-outfit text-slate-900">
        <main className="flex-1 h-full w-full relative overflow-hidden bg-slate-50">
          <Routes>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/messages" element={<Navigate to="/chat" replace />} />
            <Route path="/user-chat" element={<Navigate to="/chat" replace />} />
            <Route path="/dashboard" element={<Navigate to="/chat" replace />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/usage" element={<UsageStats />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
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

export default App;
