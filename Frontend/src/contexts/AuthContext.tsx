import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  id: number;
  name: string;
  role: string;
  avatar?: string;
}

interface AuthContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('nayaxa_assistant_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        // Hapus cache default lama jika masih menyimpan superadmin.sammy
        if (parsed.name === 'superadmin.sammy' || parsed.id === 95) {
          localStorage.removeItem('nayaxa_assistant_user');
          setCurrentUser(null);
        } else {
          setCurrentUser(parsed);
        }
      } catch {
        setCurrentUser(null);
      }
    } else {
      // Default: Akses Publik / Belum Login
      setCurrentUser(null);
    }
    setIsLoading(false);
  }, []);

  const handleSetUser = (user: User | null) => {
    setCurrentUser(user);
    if (user) {
      localStorage.setItem('nayaxa_assistant_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('nayaxa_assistant_user');
    }
  };

  const logout = () => handleSetUser(null);

  return (
    <AuthContext.Provider value={{ currentUser, setCurrentUser: handleSetUser, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
