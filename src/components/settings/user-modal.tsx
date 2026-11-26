'use client';

import { Eye, EyeOff, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import { PROFESSIONAL_COLORS, ROLE_LABELS } from '@/lib/agenda/constants';
import type { AgendaSpecialty, MemberRole } from '@/types/agenda';
import type { SettingsMember, SettingsUnit } from '@/types/settings';

interface UserModalProps {
  member: SettingsMember | null;
  units: SettingsUnit[];
  specialties: AgendaSpecialty[];
  hasServiceRole: boolean;
  canManageAdmins: boolean;
  onClose: () => void;
  onSaved: (notice?: string) => Promise<void>;
}

const ROLE_OPTIONS: { value: MemberRole; label: string; hint: string }[] = [
  {
    value: 'admin',
    label: ROLE_LABELS.admin,
    hint: 'Acesso total a usuários, unidades, planos e todas as agendas.',
  },
  {
    value: 'unit_manager',
    label: ROLE_LABELS.unit_manager,
    hint: 'Gerencia profissionais, bloqueios e usuários da unidade vinculada.',
  },
  {
    value: 'reception',
    label: ROLE_LABELS.reception,
    hint: 'Opera agendamentos, pacientes e confirmações na recepção.',
  },
  {
    value: 'professional',
    label: ROLE_LABELS.professional,
    hint: 'Acessa e gerencia a própria agenda clínica e disponibilidade.',
  },
  {
    value: 'delegated_manager',
    label: ROLE_LABELS.delegated_manager,
    hint: 'Atua apenas nas agendas delegadas explicitamente ao seu e-mail.',
  },
];

export default function UserModal({
  member,
  units,
  specialties,
  hasServiceRole,
  canManageAdmins,
  onClose,
  onSaved,
}: UserModalProps) {
  const isEditing = Boolean(member);

  const [displayName, setDisplayName] = useState(member?.display_name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<MemberRole>(member?.role ?? 'reception');
  const [unitId, setUnitId] = useState<string>(member?.unit_id ?? '');
  const [isActive, setIsActive] = useState<boolean>(member?.is_active ?? true);

  const [createProfessional, setCreateProfessional] = useState(false);
  const [color, setColor] = useState<string>(PROFESSIONAL_COLORS[0].hex);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(60);
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(
    specialties[0]?.id ? [specialties[0].id] : []
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSpecialty(id: string) {
    setSpecialtyIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (displayName.trim().length < 2) {
      setError('Informe o nome completo do usuário.');
      return;
    }

    if (!isEditing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Informe um endereço de e-mail válido.');
      return;
    }

    if (!isEditing && password && password.length < 6) {
      setError('A senha inicial deve ter pelo menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/settings/users', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEditing
            ? {
                id: member?.id,
                displayName: displayName.trim(),
                phone: phone.trim(),
                role,
                unitId: unitId || null,
                isActive,
              }
            : {
                displayName: displayName.trim(),
                email: email.trim().toLowerCase(),
                phone: phone.trim(),
                password,
                role,
                unitId: unitId || null,
                createProfessional,
                color,
                slotDurationMinutes,
                specialtyIds,
              }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar o usuário.');
        return;
      }

      await onSaved(
        data.notice ??
          (isEditing
            ? 'Dados do usuário atualizados.'
            : 'Usuário cadastrado com sucesso.')
      );
      onClose();
    } catch {
      setError('Falha de conexão ao salvar o usuário.');
    } finally {
      setSubmitting(false);
    }
  }

  const availableRoles = ROLE_OPTIONS.filter(
    (option) => canManageAdmins || option.value !== 'admin'
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <UserPlus className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2
              id="user-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              {isEditing ? 'Editar usuário da clínica' : 'Cadastrar usuário'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="user-display-name"
                className="block text-sm font-medium text-slate-700"
              >
                Nome completo
              </label>
              <input
                id="user-display-name"
                type="text"
                required
                maxLength={120}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ex.: Ana Paula Ferreira"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="user-email"
                className="block text-sm font-medium text-slate-700"
              >
                E-mail de acesso
              </label>
              <input
                id="user-email"
                type="email"
                required={!isEditing}
                disabled={isEditing}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ana@clinica.com.br"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="user-phone"
                className="block text-sm font-medium text-slate-700"
              >
                Telefone / WhatsApp (opcional)
              </label>
              <input
                id="user-phone"
                type="text"
                maxLength={40}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-0000"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {!isEditing && (
            <div>
              <label
                htmlFor="user-password"
                className="block text-sm font-medium text-slate-700"
              >
                Senha inicial (opcional para pré-cadastro)
              </label>
              <div className="relative mt-1.5">
                <input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres para criar login imediato"
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {hasServiceRole
                  ? 'Com senha preenchida, a conta será criada e confirmada na hora no Supabase Auth.'
                  : 'Se informar uma senha, a conta será criada no Supabase Auth. Sem senha, o usuário fica pré-cadastrado e é vinculado automaticamente ao entrar com este e-mail.'}
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="user-role"
                className="block text-sm font-medium text-slate-700"
              >
                Perfil de acesso
              </label>
              <select
                id="user-role"
                value={role}
                disabled={Boolean(member?.is_owner)}
                onChange={(e) => {
                  const nextRole = e.target.value as MemberRole;
                  setRole(nextRole);
                  if (!isEditing && nextRole === 'professional') {
                    setCreateProfessional(true);
                  }
                }}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 disabled:bg-slate-50 disabled:text-slate-500"
              >
                {availableRoles.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {ROLE_OPTIONS.find((r) => r.value === role)?.hint}
              </p>
            </div>

            <div>
              <label
                htmlFor="user-unit"
                className="block text-sm font-medium text-slate-700"
              >
                Unidade vinculada
              </label>
              <select
                id="user-unit"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              >
                <option value="">Todas as unidades</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {!u.is_active ? ' (Inativa)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isEditing && !member?.is_owner && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
              />
              <span>Usuário ativo na clínica</span>
            </label>
          )}

          {!isEditing && (
            <div className="rounded-lg border border-slate-200 p-4">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={createProfessional}
                  onChange={(e) => setCreateProfessional(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                />
                <span>
                  <span className="block font-medium text-slate-900">
                    Também cadastrar como profissional com agenda própria
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Cria automaticamente o perfil clínico, agenda independente e
                    horário padrão de segunda a sexta.
                  </span>
                </span>
              </label>

              {createProfessional && (
                <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="user-prof-slot"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Duração padrão da sessão
                      </label>
                      <select
                        id="user-prof-slot"
                        value={slotDurationMinutes}
                        onChange={(e) =>
                          setSlotDurationMinutes(Number(e.target.value))
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600"
                      >
                        {[30, 45, 50, 60, 90].map((min) => (
                          <option key={min} value={min}>
                            {min} minutos
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <span className="block text-xs font-medium text-slate-700">
                        Cor na grade
                      </span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {PROFESSIONAL_COLORS.map((c) => {
                          const selected =
                            color.toLowerCase() === c.hex.toLowerCase();
                          return (
                            <button
                              key={c.hex}
                              type="button"
                              onClick={() => setColor(c.hex)}
                              title={c.name}
                              className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition ${
                                selected
                                  ? 'border-slate-900 ring-1 ring-slate-900'
                                  : 'border-slate-200 hover:border-slate-400'
                              }`}
                            >
                              <span
                                className={`h-4 w-4 rounded-sm ${c.accent}`}
                                aria-hidden="true"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {specialties.length > 0 && (
                    <div>
                      <span className="block text-xs font-medium text-slate-700">
                        Especialidades atendidas
                      </span>
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        {specialties.map((sp) => {
                          const checked = specialtyIds.includes(sp.id);
                          return (
                            <label
                              key={sp.id}
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                                checked
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSpecialty(sp.id)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                              />
                              <span className="truncate font-medium">
                                {sp.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2.5 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap"
            >
              {submitting
                ? 'Salvando...'
                : isEditing
                  ? 'Salvar alterações'
                  : 'Cadastrar usuário'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
