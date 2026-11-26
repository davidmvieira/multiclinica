'use client';

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { PLANS } from '@/lib/plans';
import type { PlanDefinition, PlanSlug } from '@/types/supabase';

type AuthMode = 'login' | 'register' | 'reset';

interface LoginFormProps {
  supabaseConfigured: boolean;
  plans?: readonly PlanDefinition[];
  initialMode?: 'login' | 'register';
}

export default function LoginForm({
  supabaseConfigured,
  plans = PLANS,
  initialMode = 'login',
}: LoginFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<PlanSlug>('free');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const standardPlans = plans.filter((plan) => !plan.is_on_demand);
  const onDemandPlan = plans.find((plan) => plan.is_on_demand);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
    setConfirmPassword('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Informe um endereço de e-mail válido.');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (mode === 'reset' && password !== confirmPassword) {
      setError('A confirmação da senha não confere com a nova senha.');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail, password }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Não foi possível entrar na conta.');
          return;
        }

        router.push('/dashboard');
        router.refresh();
        return;
      }

      if (mode === 'register') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: trimmedEmail,
            password,
            planSlug: selectedPlan,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Não foi possível criar a conta.');
          return;
        }

        if (data.requiresEmailConfirmation) {
          setNotice(
            `Conta criada no plano ${data.plan?.name ?? selectedPlan}. Se o envio de e-mail ainda não estiver ativo no Supabase, clique em "Esqueci minha senha" para confirmar e definir seu acesso imediatamente.`
          );
          setMode('login');
          setPassword('');
          return;
        }

        router.push('/dashboard');
        router.refresh();
        return;
      }

      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível atualizar a senha.');
        return;
      }

      setMode('login');
      setPassword('');
      setConfirmPassword('');
      setNotice(
        data.message ??
          'Senha atualizada com sucesso no banco. Já pode entrar com a nova senha.'
      );
    } catch {
      setError('Falha de comunicação com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-12">
      <aside className="flex flex-col justify-between border-b border-slate-200 bg-slate-50 px-6 py-8 lg:col-span-5 lg:border-r lg:border-b-0 lg:px-12 lg:py-12">
        <div>
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap"
            >
              Iatris
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 whitespace-nowrap"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Início
            </Link>
          </div>

          <div className="mt-12 max-w-md lg:mt-16">
            <p className="text-sm font-semibold text-emerald-700">
              Acesso profissional
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 text-balance lg:text-4xl">
              Sua rotina clínica organizada desde o primeiro atendimento.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Crie sua conta com o mínimo de dados, escolha o plano ideal para o
              tamanho da sua equipe e comece a usar imediatamente.
            </p>

            <dl className="mt-10 space-y-5 border-t border-slate-200 pt-8">
              <div>
                <dt className="text-sm font-semibold text-slate-900">
                  Comece grátis, evolua quando precisar
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                  Do consultório individual no plano Free às clínicas com até 5
                  profissionais e 50 pacientes no Pro, ou On Demand sob medida.
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-900">
                  Autenticação segura via Supabase Auth
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                  Sessão protegida em servidor com cookies isolados e políticas
                  RLS vinculadas à sua conta.
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-2">
            <span>Iatris Clínica</span>
            <span aria-hidden="true">·</span>
            <span>
              {supabaseConfigured
                ? 'Supabase conectado ao ambiente'
                : 'Aguardando variáveis SUPABASE_URL e SUPABASE_ANON_KEY'}
            </span>
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-10 lg:col-span-7 lg:px-12">
        <div
          className={`w-full transition-all duration-150 ${
            mode === 'register' ? 'max-w-xl' : 'max-w-md'
          }`}
        >
          {!supabaseConfigured && (
            <div
              role="status"
              className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <div className="space-y-2">
                  <p className="font-semibold">
                    Configuração pendente do Supabase
                  </p>
                  <p className="leading-relaxed text-amber-900">
                    Defina <code className="font-mono text-xs">SUPABASE_URL</code> e{' '}
                    <code className="font-mono text-xs">SUPABASE_ANON_KEY</code> nas
                    variáveis de ambiente para ativar o cadastro e o login real.
                  </p>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 font-semibold text-amber-950 underline underline-offset-4 hover:text-amber-800"
                  >
                    Abrir guia de integração no painel
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                {mode === 'login' && 'Entrar na sua conta'}
                {mode === 'register' && 'Criar conta em menos de 1 minuto'}
                {mode === 'reset' && 'Definir nova senha'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {mode === 'login' &&
                  'Use seu e-mail e senha cadastrados no Supabase.'}
                {mode === 'register' &&
                  'Informe apenas seus dados de acesso e selecione a capacidade desejada.'}
                {mode === 'reset' &&
                  'Informe seu e-mail e a nova senha para atualizar o acesso diretamente no banco.'}
              </p>
            </div>

            {mode !== 'reset' && (
              <div
                role="tablist"
                aria-label="Modo de autenticação"
                className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  onClick={() => switchMode('login')}
                  className={`h-9 cursor-pointer rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    mode === 'login'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  onClick={() => switchMode('register')}
                  className={`h-9 cursor-pointer rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    mode === 'register'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Criar conta
                </button>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div
                role="status"
                className="mt-5 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"
                  aria-hidden="true"
                />
                <span>{notice}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-name"
                    className="block text-sm font-medium text-slate-800"
                  >
                    Seu nome ou clínica{' '}
                    <span className="font-normal text-slate-500">(opcional)</span>
                  </label>
                  <div className="relative mt-1.5">
                    <User
                      className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex.: Clínica Movimento ou Dra. Helena"
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-3.5 pl-10 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div
                className={
                  mode === 'register'
                    ? 'grid gap-4 sm:grid-cols-2'
                    : 'space-y-4'
                }
              >
                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-sm font-medium text-slate-800"
                  >
                    E-mail
                  </label>
                  <div className="relative mt-1.5">
                    <Mail
                      className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="voce@clinica.com.br"
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-3.5 pl-10 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="auth-password"
                      className="block text-sm font-medium text-slate-800"
                    >
                      {mode === 'reset' ? 'Nova senha' : 'Senha'}
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => switchMode('reset')}
                        className="cursor-pointer text-xs font-medium text-emerald-700 transition-colors hover:text-emerald-800 focus-visible:underline focus:outline-none"
                      >
                        Esqueci minha senha
                      </button>
                    )}
                  </div>
                  <div className="relative mt-1.5">
                    <Lock
                      className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete={
                        mode === 'login' ? 'current-password' : 'new-password'
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-11 pl-10 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword ? 'Ocultar senha' : 'Mostrar senha'
                      }
                      className="absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-emerald-600 focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {mode === 'reset' && (
                  <div>
                    <label
                      htmlFor="auth-confirm-password"
                      className="block text-sm font-medium text-slate-800"
                    >
                      Confirmar nova senha
                    </label>
                    <div className="relative mt-1.5">
                      <Lock
                        className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id="auth-confirm-password"
                        name="confirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a nova senha"
                        className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-11 pl-10 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={
                          showConfirmPassword
                            ? 'Ocultar confirmação de senha'
                            : 'Mostrar confirmação de senha'
                        }
                        className="absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-emerald-600 focus:outline-none"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {mode === 'register' && (
                <fieldset className="pt-2">
                  <legend className="block text-sm font-medium text-slate-800">
                    Escolha seu plano
                  </legend>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Selecione a capacidade inicial de profissionais e pacientes.
                  </p>

                  <div
                    role="radiogroup"
                    aria-label="Planos disponíveis"
                    className="mt-3 space-y-2.5"
                  >
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      {standardPlans.map((plan) => {
                        const isSelected = selectedPlan === plan.slug;
                        return (
                          <button
                            key={plan.slug}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => setSelectedPlan(plan.slug)}
                            className={`flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-emerald-600 focus:outline-none ${
                              isSelected
                                ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {plan.name}
                              </span>
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                  isSelected
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : 'border-slate-300 bg-white'
                                }`}
                                aria-hidden="true"
                              >
                                {isSelected && <Check className="h-2.5 w-2.5" />}
                              </span>
                            </div>

                            <div className="mt-3 space-y-1 text-xs text-slate-600 tabular-nums">
                              <div>
                                <span className="font-semibold text-slate-900">
                                  {plan.max_professionals}
                                </span>{' '}
                                {plan.max_professionals === 1
                                  ? 'profissional'
                                  : 'profissionais'}
                              </div>
                              <div>
                                <span className="font-semibold text-slate-900">
                                  {plan.max_patients}
                                </span>{' '}
                                {plan.max_patients === 1
                                  ? 'paciente'
                                  : 'pacientes'}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {onDemandPlan && (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selectedPlan === onDemandPlan.slug}
                        onClick={() => setSelectedPlan(onDemandPlan.slug)}
                        className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-emerald-600 focus:outline-none ${
                          selectedPlan === onDemandPlan.slug
                            ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {onDemandPlan.name}
                            </span>
                            <span
                              className="text-xs text-slate-400"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span className="text-xs text-slate-600">
                              Acima de 5 profissionais e 50 pacientes (sob medida)
                            </span>
                          </div>
                        </div>
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            selectedPlan === onDemandPlan.slug
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                          aria-hidden="true"
                        >
                          {selectedPlan === onDemandPlan.slug && (
                            <Check className="h-2.5 w-2.5" />
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                </fieldset>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
              >
                {loading ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Processando...</span>
                  </>
                ) : (
                  <>
                    {mode === 'login' && (
                      <>
                        <span>Entrar no painel</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                    {mode === 'register' && (
                      <>
                        <span>Criar conta</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                    {mode === 'reset' && (
                      <>
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                        <span>Atualizar senha</span>
                      </>
                    )}
                  </>
                )}
              </button>

              {mode === 'reset' ? (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400 focus:outline-none"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Voltar para o login
                </button>
              ) : (
                <p className="pt-2 text-center text-xs text-slate-500">
                  {mode === 'login' ? (
                    <>
                      Ainda não tem acesso?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('register')}
                        className="cursor-pointer font-semibold text-emerald-700 underline-offset-4 hover:underline"
                      >
                        Criar conta agora
                      </button>
                    </>
                  ) : (
                    <>
                      Já possui cadastro?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="cursor-pointer font-semibold text-emerald-700 underline-offset-4 hover:underline"
                      >
                        Entrar na conta
                      </button>
                    </>
                  )}
                </p>
              )}
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
