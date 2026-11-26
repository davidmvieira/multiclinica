'use client';

import { Eye, EyeOff, Plus, Stethoscope, X } from 'lucide-react';
import { useState } from 'react';

import { PROFESSIONAL_COLORS } from '@/lib/agenda/constants';
import type { AgendaSpecialty, MemberRole } from '@/types/agenda';
import type {
  SettingsMember,
  SettingsProfessional,
  SettingsUnit,
} from '@/types/settings';

interface AdminProfessionalModalProps {
  professional: SettingsProfessional | null;
  units: SettingsUnit[];
  specialties: AgendaSpecialty[];
  members: SettingsMember[];
  canManageAdmins?: boolean;
  onClose: () => void;
  onSaved: (notice?: string) => Promise<void>;
  onSpecialtyCreated: (spec: AgendaSpecialty) => void;
}

export default function AdminProfessionalModal({
  professional,
  units,
  specialties,
  members,
  canManageAdmins = true,
  onClose,
  onSaved,
  onSpecialtyCreated,
}: AdminProfessionalModalProps) {
  const isEditing = Boolean(professional);

  const initialUnits =
    professional?.unit_ids && professional.unit_ids.length > 0
      ? professional.unit_ids
      : professional?.unit_id
        ? [professional.unit_id]
        : units[0]?.id
          ? [units[0].id]
          : [];

  const [name, setName] = useState(professional?.name ?? '');
  const [email, setEmail] = useState(professional?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [memberRole, setMemberRole] = useState<MemberRole>('professional');
  const [phone, setPhone] = useState(professional?.phone ?? '');
  const [councilNumber, setCouncilNumber] = useState(
    professional?.council_number ?? ''
  );
  const [userId, setUserId] = useState(professional?.user_id ?? '');
  const [unitIds, setUnitIds] = useState<string[]>(initialUnits);
  const [color, setColor] = useState(
    professional?.color ?? PROFESSIONAL_COLORS[0].hex
  );
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(
    professional?.specialty_ids ??
      (specialties[0]?.id ? [specialties[0].id] : [])
  );
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(
    professional?.schedule?.slot_duration_minutes ?? 60
  );
  const [isActive, setIsActive] = useState(professional?.is_active ?? true);

  const [newSpecName, setNewSpecName] = useState('');
  const [addingSpec, setAddingSpec] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkableMembers = members.filter((m) => Boolean(m.user_id));

  function toggleSpecialty(id: string) {
    setSpecialtyIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function toggleUnit(id: string) {
    setUnitIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleQuickAddSpecialty() {
    const trimmed = newSpecName.trim();
    if (trimmed.length < 2 || addingSpec) return;

    setAddingSpec(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/specialties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, color }),
      });
      const data = await res.json();
      if (!res.ok || !data.specialty) {
        setError(data.error ?? 'Não foi possível criar a especialidade.');
        return;
      }
      onSpecialtyCreated(data.specialty);
      setSpecialtyIds((prev) => [...prev, data.specialty.id]);
      setNewSpecName('');
    } catch {
      setError('Falha ao adicionar especialidade.');
    } finally {
      setAddingSpec(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Informe o nome do profissional.');
      return;
    }

    if (!isEditing && password && !email.trim()) {
      setError('Informe o e-mail do profissional para definir uma senha de acesso.');
      return;
    }

    if (!isEditing && password && password.length < 6) {
      setError('A senha de acesso deve ter pelo menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/agenda/professionals', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: professional?.id,
          name: name.trim(),
          email: email.trim(),
          ...(!isEditing && password ? { password, memberRole } : {}),
          ...(!isEditing && !password && email.trim() ? { memberRole } : {}),
          phone: phone.trim(),
          councilNumber: councilNumber.trim(),
          userId: userId || null,
          unitId: unitIds[0] ?? null,
          unitIds,
          color,
          specialtyIds,
          slotDurationMinutes,
          isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar o profissional.');
        return;
      }
      await onSaved(
        data.notice ??
          (isEditing
            ? 'Profissional e agenda atualizados.'
            : 'Profissional e agenda independente criados.')
      );
      onClose();
    } catch {
      setError('Falha de conexão ao salvar profissional.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-prof-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Stethoscope
              className="h-5 w-5 text-emerald-600"
              aria-hidden="true"
            />
            <h2
              id="admin-prof-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              {isEditing
                ? 'Editar profissional e agenda'
                : 'Novo profissional com agenda'}
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
                htmlFor="admin-prof-name"
                className="block text-sm font-medium text-slate-700"
              >
                Nome completo
              </label>
              <input
                id="admin-prof-name"
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Dra. Marina Costa"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="admin-prof-email"
                className="block text-sm font-medium text-slate-700"
              >
                E-mail de acesso (opcional)
              </label>
              <input
                id="admin-prof-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="marina@clinica.com.br"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="admin-prof-council"
                className="block text-sm font-medium text-slate-700"
              >
                Registro no conselho (opcional)
              </label>
              <input
                id="admin-prof-council"
                type="text"
                maxLength={40}
                value={councilNumber}
                onChange={(e) => setCouncilNumber(e.target.value)}
                placeholder="Ex.: CREFITO 123456-F"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            {!isEditing && !userId && (
              <>
                <div>
                  <label
                    htmlFor="admin-prof-password"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Senha inicial de acesso (opcional)
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="admin-prof-password"
                      type={showPassword ? 'text' : 'password'}
                      minLength={6}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres para login"
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 text-sm text-slate-900 outline-none focus:border-emerald-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-800"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="admin-prof-role"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Perfil de acesso na clínica
                  </label>
                  <select
                    id="admin-prof-role"
                    value={memberRole}
                    onChange={(e) => setMemberRole(e.target.value as MemberRole)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                  >
                    <option value="professional">Profissional (própria agenda)</option>
                    <option value="unit_manager">Gestor de unidade</option>
                    {canManageAdmins && (
                      <option value="admin">Administrador da clínica</option>
                    )}
                  </select>
                </div>
              </>
            )}

            <div>
              <label
                htmlFor="admin-prof-phone"
                className="block text-sm font-medium text-slate-700"
              >
                Telefone / WhatsApp (opcional)
              </label>
              <input
                id="admin-prof-phone"
                type="text"
                maxLength={40}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-0000"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="admin-prof-user"
                className="block text-sm font-medium text-slate-700"
              >
                Conta já existente na clínica
              </label>
              <select
                id="admin-prof-user"
                value={userId}
                onChange={(e) => {
                  const nextUid = e.target.value;
                  setUserId(nextUid);
                  const matched = linkableMembers.find(
                    (m) => m.user_id === nextUid
                  );
                  if (matched?.email && !email) {
                    setEmail(matched.email);
                  }
                }}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              >
                <option value="">
                  {isEditing ? 'Sem conta vinculada' : 'Vincular/criar por e-mail'}
                </option>
                {linkableMembers.map((m) => (
                  <option key={m.id} value={m.user_id ?? ''}>
                    {m.display_name || m.email} ({m.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="admin-prof-slot"
                className="block text-sm font-medium text-slate-700"
              >
                Duração padrão da sessão
              </label>
              <select
                id="admin-prof-slot"
                value={slotDurationMinutes}
                onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              >
                {[30, 45, 50, 60, 90].map((min) => (
                  <option key={min} value={min}>
                    {min} minutos
                  </option>
                ))}
              </select>
            </div>
          </div>

          {units.length > 0 && (
            <div>
              <span className="block text-sm font-medium text-slate-700">
                Unidades de atendimento
              </span>
              <p className="mt-0.5 text-xs text-slate-500">
                Selecione uma ou mais unidades em que o profissional atende nesta clínica.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {units.map((u) => {
                  const checked = unitIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                        checked
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUnit(u.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                      />
                      <span className="truncate font-medium">
                        {u.name}
                        {!u.is_active ? ' (Inativa)' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="block text-sm font-medium text-slate-700">
                Especialidades atendidas
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {specialties.map((sp) => {
                const checked = specialtyIds.includes(sp.id);
                return (
                  <label
                    key={sp.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                      checked
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSpecialty(sp.id)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                    />
                    <span className="truncate font-medium">{sp.name}</span>
                  </label>
                );
              })}
            </div>

            <div className="mt-2.5 flex gap-2">
              <input
                type="text"
                value={newSpecName}
                onChange={(e) => setNewSpecName(e.target.value)}
                maxLength={80}
                placeholder="Adicionar nova especialidade (ex.: Fonoaudiologia)"
                className="h-9 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-emerald-600"
              />
              <button
                type="button"
                onClick={handleQuickAddSpecialty}
                disabled={addingSpec || newSpecName.trim().length < 2}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {addingSpec ? 'Criando...' : 'Incluir'}
              </button>
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700">
              Cor identificadora na grade
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {PROFESSIONAL_COLORS.map((c) => {
                const selected = color.toLowerCase() === c.hex.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColor(c.hex)}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                      selected
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-sm ${c.accent}`}
                      aria-hidden="true"
                    />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {isEditing && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
              />
              <span>Profissional e agenda ativos</span>
            </label>
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
                  ? 'Salvar profissional'
                  : 'Criar profissional e agenda'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
