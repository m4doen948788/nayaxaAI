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
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulasi loading identitas dari database/session
    // Default awal adalah Sammy (ID 95) yang baru kita buat
    const savedUser = localStorage.getItem('nayaxa_assistant_user');
    if (savedUser) {
      setCurrentUser(JSON.parse(savedUser));
    } else {
      const defaultUser = { 
        id: 95, 
        name: 'superadmin.sammy', 
        role: 'Super Administrator',
        avatar: 'S'
      };
      setCurrentUser(defaultUser);
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

  return (
    <AuthContext.Provider value={{ currentUser, setCurrentUser: handleSetUser, isLoading }}>
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
