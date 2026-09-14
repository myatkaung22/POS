import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { AuthUser, SettingsMap } from "./types";

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  settings: SettingsMap;
  permissions: Record<string, string[]>;
  unreadInbox: number;
  loading: boolean;
  login: (body: { email?: string; password?: string; pin?: string }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  setUnread: (n: number | ((prev: number) => number)) => void;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(getToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [unreadInbox, setUnreadInbox] = useState(0);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const refresh = async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{
        user: AuthUser;
        settings: SettingsMap;
        unreadInbox: number;
        permissions: Record<string, string[]>;
      }>("/api/bootstrap");
      setUser(data.user);
      setSettings(data.settings);
      setPermissions(data.permissions);
      setUnreadInbox(data.unreadInbox);
    } catch {
      setToken(null);
      setTok(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      settings,
      permissions,
      unreadInbox,
      loading,
      async login(body) {
        const data = await api<{ token: string; user: AuthUser }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setToken(data.token);
        setTok(data.token);
        setUser(data.user);
        await refresh();
      },
      logout() {
        setToken(null);
        setTok(null);
        setUser(null);
      },
      refresh,
      setUnread: setUnreadInbox,
      can(permission) {
        return (permissions[permission] || []).includes(user?.role || "");
      },
    }),
    [token, user, settings, permissions, unreadInbox, loading]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
