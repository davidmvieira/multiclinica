'use client';

import {
  Check,
  Copy,
  Database,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
import { useState } from 'react';

interface AgendaSqlSetupProps {
  mode: 'table_not_found' | 'needs_bootstrap';
  planLimits: {
    planName: string;
    maxProfessionals: number | null;
    maxPatients: number | null;
  };
  onReload: () => Promise<void>;
}

export default function AgendaSqlSetup({
  mode,
  planLimits,
  onReload,
}: AgendaSqlSetupProps) {
  const [clinicName, setClinicName] = useState('Clínica Iatris');
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>(
    'idle'
  );
  const [loadingMode, setLoadingMode] = useState<'starter' | 'empty' | null>(
    null
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCopySql() {
    setError(null);
    setCopyState('copying');
    try {
      const res = await fetch('/api/agenda/sql');
      const data = await res.json();
      if (!res.ok || !data.sql) {
        setError(
          data.error ??
            'Copie o SQL da Seção 3 do arquivo sql.md no repositório.'
        );
        setCopyState('idle');
        return;
      }
      await navigator.clipboard.writeText(data.sql);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 3000);
    } catch {
      setError('Não foi possível copiar automaticamente. Consulte sql.md.');
      setCopyState('idle');
    }
  }

  async function handleVerifyTables() {
    setChecking(true);
    setError(null);
    try {
      await onReload();
    } finally {
      setChecking(false);
    }
  }

  async function handleBootstrap(seedStarterTeam: boolean) {
    setError(null);
    setLoadingMode(seedStarterTeam ? 'starter' : 'empty');
    try {
      const res = await fetch('/api/agenda/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicName: clinicName.trim() || 'Minha Clínica',
          seedStarterTeam,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao inicializar estrutura da clínica.');
        return;
      }
      await onReload();
    } catch {
      setError('Falha de conexão ao inicializar a clínica.');
    } finally {
      setLoadingMode(null);
    }
  }

  if (mode === 'table_not_found') {
    return (
      <section className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700">
            <Database className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900">
              Configuração do banco para Agenda Multiprofissional
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              As tabelas da agenda multiprofissional ainda não foram aplicadas no
              seu projeto Supabase. Execute o script da{' '}
              <span className="font-mono font-medium text-slate-800">
                Seção 3 do arquivo sql.md
              </span>{' '}
              no SQL Editor do Supabase e clique em verificar.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
              >
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCopySql}
                disabled={copyState === 'copying'}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {copyState === 'copied' ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    SQL copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-slate-600" aria-hidden="true" />
                    Copiar SQL da Agenda
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleVerifyTables}
                disabled={checking}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {checking
                  ? 'Verificando...'
                  : 'Verificar tabelas no Supabase'}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
          <Users className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-900">
            Inicializar estrutura da clínica
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            Suas tabelas estão prontas. Crie sua organização clínica e unidade
            principal para liberar agendas independentes e visão geral
            consolidada.
          </p>

          <p className="mt-2 font-mono text-xs text-slate-500 tabular-nums">
            Plano ativo: {planLimits.planName} ·{' '}
            {planLimits.maxProfessionals === null
              ? 'Profissionais ilimitados'
              : `Até ${planLimits.maxProfessionals} ${
                  planLimits.maxProfessionals === 1
                    ? 'profissional'
                    : 'profissionais'
                }`}{' '}
            ·{' '}
            {planLimits.maxPatients === null
              ? 'Pacientes ilimitados'
              : `Até ${planLimits.maxPatients} pacientes`}
          </p>

          <div className="mt-5">
            <label
              htmlFor="clinic-name"
              className="block text-sm font-medium text-slate-700"
            >
              Nome da clínica
            </label>
            <input
              id="clinic-name"
              type="text"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              maxLength={120}
              placeholder="Ex.: Clínica Iatris Reabilitação"
              className="mt-1.5 h-10 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleBootstrap(true)}
              disabled={loadingMode !== null}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {loadingMode === 'starter'
                ? 'Criando equipe e horários...'
                : 'Inicializar com equipe e horários de exemplo'}
            </button>

            <button
              type="button"
              onClick={() => handleBootstrap(false)}
              disabled={loadingMode !== null}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingMode === 'empty'
                ? 'Inicializando...'
                : 'Inicializar clínica vazia'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
