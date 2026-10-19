import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface UserProfile {
  id: string;
  username: string;
  role: 'admin' | 'member';
}

export interface AuthContextType {
  user: UserProfile | null;
  csrfToken: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/browser/session', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'same-origin',
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setCsrfToken(data.csrfToken);
      } else {
        setUser(null);
        setCsrfToken(null);
      }
    } catch {
      setUser(null);
      setCsrfToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/browser/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }

      setUser(data.user);
      setCsrfToken(data.csrfToken);
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network error during login',
      };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await fetch('/api/v1/browser/session', {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
      });
    } catch {
      // Ignore network errors during logout
    } finally {
      setUser(null);
      setCsrfToken(null);
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, csrfToken, isLoading, login, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
