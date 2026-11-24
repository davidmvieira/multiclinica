'use client';

import {
  Calendar,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import type { AuthUser } from '@/types/supabase';

const navItems = [
  { href: '/dashboard', label: 'Visão Geral', icon: LayoutDashboard },
  { href: '/agenda', label: 'Agenda', icon: Calendar },
  { href: '/pacientes', label: 'Pacientes', icon: Users },
  { href: '/avaliacoes', label: 'Avaliações', icon: ClipboardCheck },
  { href: '/evolucoes', label: 'Evoluções', icon: FileText },
  { href: '/financeiro', label: 'Financeiro', icon: Wallet },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];

const routeTitles: Record<string, string> = {
  '/dashboard': 'Visão Geral',
  '/agenda': 'Agenda',
  '/pacientes': 'Pacientes',
  '/avaliacoes': 'Avaliações',
  '/evolucoes': 'Evoluções',
  '/financeiro': 'Financeiro',
  '/configuracoes': 'Configurações',
};

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;

    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setUser(data.user ?? null);
        setSessionLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setSessionLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      router.push('/login');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const currentSection =
    Object.entries(routeTitles).find(
      ([route]) => pathname === route || pathname.startsWith(`${route}/`)
    )?.[1] ?? 'Painel';

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between">
      <div>
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Iatris
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Menu clínico" className="space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-200 p-4">
        {sessionLoaded && user ? (
          <div className="space-y-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {user.name ?? 'Profissional'}
              </p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {loggingOut ? 'Saindo...' : 'Sair da conta'}
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Entrar com Supabase
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-white text-slate-900">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-slate-50 lg:block">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/30"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-64 border-r border-slate-200 bg-slate-50">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir navegação"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              <Link
                href="/dashboard"
                className="font-medium text-slate-500 transition-colors hover:text-slate-900 whitespace-nowrap"
              >
                Iatris
              </Link>
              <span className="text-slate-300" aria-hidden="true">
                /
              </span>
              <span className="truncate font-semibold text-slate-900">
                {currentSection}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={user ? '/agenda' : '/login'}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap shrink-0"
            >
              {user ? 'Abrir agenda' : 'Entrar'}
            </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
