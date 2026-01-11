import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';

export interface User {
  id: string;
  username: string;
  email?: string;
  storagePath?: string;
  isPaid?: boolean;
  isAdmin?: boolean;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User) => void;
  logout: () => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = user !== null;

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const apiBase = (import.meta as any).env.VITE_API_URL || '';
        const res = await fetch(`${apiBase}/api/auth/check`, {
          credentials: 'include',
        });
        const data = await res.json();

        if (data.isAuthenticated) {
          setUser(data.user);

          // Handle domain redirects for authenticated users
          if (
            window.location.hostname === 'infoverse.ai' &&
            !window.location.hostname.startsWith('app.')
          ) {
            window.location.href = `https://app.infoverse.ai${window.location.pathname}`;
          }
        } else {
          // Handle domain redirects for unauthenticated users
          if (window.location.hostname === 'app.infoverse.ai') {
            window.location.href = `https://infoverse.ai${window.location.pathname}`;
          }
        }
      } catch (err) {
        console.error('Auth check failed:', err);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback((newUser: User) => {
    setUser(newUser);

    // Handle domain redirect after login
    if (
      window.location.hostname === 'infoverse.ai' &&
      !window.location.hostname.startsWith('app.')
    ) {
      window.location.href = 'https://app.infoverse.ai';
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const apiBase = (import.meta as any).env.VITE_API_URL || '';
      await fetch(`${apiBase}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      setUser(null);
    } catch (err) {
      console.error('Logout failed:', err);
      throw err;
    }
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
