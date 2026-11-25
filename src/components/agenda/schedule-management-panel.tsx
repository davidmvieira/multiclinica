'use client';

import {
  Check,
  Clock,
  History,
  Pencil,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  DAY_NAMES_PT,
  ROLE_LABELS,
  getColorTheme,
} from '@/lib/agenda/constants';
import type {
  AgendaAuditLog,
  AgendaAvailabilityRule,
  AgendaProfessional,
  AgendaSchedule,
  AgendaScheduleManager,
  AgendaSpecialty,
  AgendaUnit,
  MemberRole,
  SchedulePermissionFlags,
} from '@/types/agenda';

interface ScheduleManagementPanelProps {
  timeZone: string;
  isAdmin: boolean;
  professionals: AgendaProfessional[];
  schedules: AgendaSchedule[];
  specialties: AgendaSpecialty[];
  units: AgendaUnit[];
  availabilityRules: AgendaAvailabilityRule[];
  managers: AgendaScheduleManager[];
  auditLogs: AgendaAuditLog[];
  permissionsBySchedule: Record<string, SchedulePermissionFlags>;
  planLimits: {
    planName: string;
    maxProfessionals: number | null;
  };
  onAddProfessional: () => void;
  onEditProfessional: (prof: AgendaProfessional) => void;
  onSaved: () => Promise<void>;
}

interface EditableDayRule {
  day_of_week: number;
  is_active: boolean;
  start_time: string;
  end_time: string;
  break_start: string;
  break_end: string;
}

const AUDIT_LABELS: Record<string, string> = {
  create_appointment: 'Agendamento criado',
  create_recurring_appointment: 'Série recorrente criada',
  reschedule_appointment: 'Reagendamento realizado',
  change_status: 'Situação alterada',
  cancel_appointment: 'Agendamento cancelado',
  update_appointment: 'Agendamento editado',
  update_availability: 'Disponibilidade atualizada',
  create_block: 'Bloqueio criado',
  delete_block: 'Bloqueio removido',
  assign_schedule_manager: 'Gestor delegado adicionado',
  update_schedule_manager: 'Permissões de gestor alteradas',
  remove_schedule_manager: 'Gestor removido da agenda',
  create_professional_schedule: 'Profissional e agenda criados',
};

export default function ScheduleManagementPanel({
  timeZone,
  isAdmin,
  professionals,
  schedules,
  specialties,
  units,
  availabilityRules,
  managers,
  auditLogs,
  permissionsBySchedule,
  planLimits,
  onAddProfessional,
  onEditProfessional,
  onSaved,
}: ScheduleManagementPanelProps) {
  const [selectedScheduleId, setSelectedScheduleId] = useState(
    schedules[0]?.id ?? ''
  );

  useEffect(() => {
    if (
      schedules.length > 0 &&
      !schedules.some((s) => s.id === selectedScheduleId)
    ) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  const [dayRules, setDayRules] = useState<EditableDayRule[]>([]);
  const [savingRules, setSavingRules] = useState(false);
  const [rulesMessage, setRulesMessage] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);

  // Delegated manager form state
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerRole, setManagerRole] =
    useState<MemberRole>('delegated_manager');
  const [canView, setCanView] = useState(true);
  const [canManageAppointments, setCanManageAppointments] = useState(true);
  const [canManageAvailability, setCanManageAvailability] = useState(false);
  const [canManageBlocks, setCanManageBlocks] = useState(false);
  const [savingManager, setSavingManager] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);

  useEffect(() => {
    const built: EditableDayRule[] = [1, 2, 3, 4, 5, 6, 0].map((day) => {
      const existing = availabilityRules.find(
        (r) => r.schedule_id === selectedScheduleId && r.day_of_week === day
      );
      return {
        day_of_week: day,
        is_active: existing ? existing.is_active : day >= 1 && day <= 5,
        start_time: existing ? existing.start_time.slice(0, 5) : '08:00',
        end_time: existing ? existing.end_time.slice(0, 5) : '18:00',
        break_start: existing?.break_start
          ? existing.break_start.slice(0, 5)
          : '12:00',
        break_end: existing?.break_end
          ? existing.break_end.slice(0, 5)
          : '13:00',
      };
    });
    setDayRules(built);
    setRulesMessage(null);
    setRulesError(null);
  }, [selectedScheduleId, availabilityRules]);

  const selectedPerms = permissionsBySchedule[selectedScheduleId];
  const canEditAvailability = Boolean(selectedPerms?.can_manage_availability);

  const scheduleManagers = managers.filter(
    (m) => m.schedule_id === selectedScheduleId
  );

  function updateRule(dayOfWeek: number, patch: Partial<EditableDayRule>) {
    setDayRules((prev) =>
      prev.map((r) =>
        r.day_of_week === dayOfWeek ? { ...r, ...patch } : r
      )
    );
  }

  async function handleSaveRules() {
    if (!selectedScheduleId || !canEditAvailability) return;
    setSavingRules(true);
    setRulesError(null);
    setRulesMessage(null);
    try {
      const res = await fetch('/api/agenda/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: selectedScheduleId,
          rules: dayRules.map((r) => ({
            day_of_week: r.day_of_week,
            is_active: r.is_active,
            start_time: r.start_time,
            end_time: r.end_time,
            break_start: r.break_start || null,
            break_end: r.break_end || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRulesError(data.error ?? 'Não foi possível salvar a jornada.');
        return;
      }
      setRulesMessage('Jornada e disponibilidade salvas com sucesso.');
      await onSaved();
    } catch {
      setRulesError('Falha de conexão ao salvar disponibilidade.');
    } finally {
      setSavingRules(false);
    }
  }

  async function handleAddManager(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin || !selectedScheduleId) return;
    setManagerError(null);
    setSavingManager(true);
    try {
      const res = await fetch('/api/agenda/managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: selectedScheduleId,
          managerName,
          managerEmail,
          role: managerRole,
          canView,
          canManageAppointments,
          canManageAvailability,
          canManageBlocks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManagerError(data.error ?? 'Erro ao vincular gestor.');
        return;
      }
      setManagerName('');
      setManagerEmail('');
      await onSaved();
    } catch {
      setManagerError('Falha de conexão ao delegar acesso.');
    } finally {
      setSavingManager(false);
    }
  }

  async function handleToggleManagerPerm(
    manager: AgendaScheduleManager,
    field:
      | 'canView'
      | 'canManageAppointments'
      | 'canManageAvailability'
      | 'canManageBlocks',
    nextVal: boolean
  ) {
    if (!isAdmin) return;
    setManagerError(null);
    try {
      const res = await fetch('/api/agenda/managers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: manager.id,
          [field]: nextVal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManagerError(data.error ?? 'Erro ao atualizar permissão.');
        return;
      }
      await onSaved();
    } catch {
      setManagerError('Falha ao atualizar permissão.');
    }
  }

  async function handleRemoveManager(id: string) {
    if (!isAdmin) return;
    setManagerError(null);
    try {
      const res = await fetch(
        `/api/agenda/managers?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        setManagerError(data.error ?? 'Erro ao remover gestor.');
        return;
      }
      await onSaved();
    } catch {
      setManagerError('Falha ao remover gestor.');
    }
  }

  return (
    <div className="space-y-8">
      {/* 1. Equipe e Agendas Independentes */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Agendas independentes por profissional
            </h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
              {professionals.length} profissional(is) ativo(s) · Plano{' '}
              {planLimits.planName}
              {planLimits.maxProfessionals !== null
                ? ` (limite ${planLimits.maxProfessionals})`
                : ' (ilimitado)'}
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={onAddProfessional}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Novo profissional
            </button>
          )}
        </div>

        <div className="mt-4 divide-y divide-slate-100">
          {professionals.map((prof) => {
            const theme = getColorTheme(prof.color);
            const profSpecs = specialties
              .filter((s) => prof.specialty_ids.includes(s.id))
              .map((s) => s.name);
            const unit = units.find((u) => u.id === prof.unit_id);
            const sched = schedules.find((s) => s.professional_id === prof.id);
            const isSelected = sched?.id === selectedScheduleId;

            return (
              <div
                key={prof.id}
                className={`flex flex-wrap items-center justify-between gap-3 py-3 transition ${
                  isSelected ? 'bg-slate-50/70 -mx-3 px-3 rounded-lg' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-sm ${theme.accent}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {prof.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {profSpecs.length > 0
                        ? profSpecs.join(' · ')
                        : 'Sem especialidade'}
                      {unit ? ` · ${unit.name}` : ''}
                      {sched
                        ? ` · Slot padrão ${sched.slot_duration_minutes} min`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {sched && (
                    <button
                      type="button"
                      onClick={() => setSelectedScheduleId(sched.id)}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {isSelected ? 'Configurando' : 'Configurar horários'}
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onEditProfessional(prof)}
                      aria-label={`Editar ${prof.name}`}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Editar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Disponibilidade semanal da agenda selecionada */}
      {selectedScheduleId && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2.5">
              <Clock
                className="h-5 w-5 text-emerald-600"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Disponibilidade semanal
                </h2>
                <p className="text-xs text-slate-500">
                  Defina dias de atendimento, início, término e intervalo.
                </p>
              </div>
            </div>

            <select
              aria-label="Selecionar agenda para disponibilidade"
              value={selectedScheduleId}
              onChange={(e) => setSelectedScheduleId(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-emerald-600"
            >
              {schedules.map((s) => {
                const prof = professionals.find(
                  (p) => p.id === s.professional_id
                );
                return (
                  <option key={s.id} value={s.id}>
                    {prof?.name ?? s.name}
                  </option>
                );
              })}
            </select>
          </div>

          {rulesError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {rulesError}
            </div>
          )}
          {rulesMessage && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
              <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
              {rulesMessage}
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">Dia</th>
                  <th className="py-2 px-3">Ativo</th>
                  <th className="py-2 px-3">Início</th>
                  <th className="py-2 px-3">Término</th>
                  <th className="py-2 px-3">Intervalo início</th>
                  <th className="py-2 pl-3">Intervalo fim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dayRules.map((rule) => (
                  <tr key={rule.day_of_week}>
                    <td className="py-2.5 pr-3 font-medium text-slate-900">
                      {DAY_NAMES_PT[rule.day_of_week]}
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="checkbox"
                        aria-label={`Ativar ${DAY_NAMES_PT[rule.day_of_week]}`}
                        checked={rule.is_active}
                        disabled={!canEditAvailability}
                        onChange={(e) =>
                          updateRule(rule.day_of_week, {
                            is_active: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="time"
                        value={rule.start_time}
                        disabled={!canEditAvailability || !rule.is_active}
                        onChange={(e) =>
                          updateRule(rule.day_of_week, {
                            start_time: e.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-slate-300 px-2 font-mono text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="time"
                        value={rule.end_time}
                        disabled={!canEditAvailability || !rule.is_active}
                        onChange={(e) =>
                          updateRule(rule.day_of_week, {
                            end_time: e.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-slate-300 px-2 font-mono text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="time"
                        value={rule.break_start}
                        disabled={!canEditAvailability || !rule.is_active}
                        onChange={(e) =>
                          updateRule(rule.day_of_week, {
                            break_start: e.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-slate-300 px-2 font-mono text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    </td>
                    <td className="py-2.5 pl-3">
                      <input
                        type="time"
                        value={rule.break_end}
                        disabled={!canEditAvailability || !rule.is_active}
                        onChange={(e) =>
                          updateRule(rule.day_of_week, {
                            break_end: e.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-slate-300 px-2 font-mono text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              {canEditAvailability
                ? 'Alterações passam a valer imediatamente na validação de agendamentos.'
                : 'Você não possui permissão para editar a disponibilidade desta agenda.'}
            </p>
            {canEditAvailability && (
              <button
                type="button"
                onClick={handleSaveRules}
                disabled={savingRules}
                className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {savingRules ? 'Salvando...' : 'Salvar disponibilidade'}
              </button>
            )}
          </div>
        </section>
      )}

      {/* 3. Gestão compartilhada e delegação */}
      {selectedScheduleId && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2.5 border-b border-slate-200 pb-4">
            <Shield className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Gestão compartilhada e permissões
              </h2>
              <p className="text-xs text-slate-500">
                Delegue recepção ou gestores para operar esta agenda sem
                duplicar registros. Remover um gestor não exclui a agenda nem
                seus agendamentos.
              </p>
            </div>
          </div>

          {managerError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {managerError}
            </div>
          )}

          {scheduleManagers.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              Nenhum gestor delegado atribuído especificamente a esta agenda.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {scheduleManagers.map((mgr) => (
                <div
                  key={mgr.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <UserCheck
                        className="h-4 w-4 text-emerald-600"
                        aria-hidden="true"
                      />
                      {mgr.manager_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {mgr.manager_email} · {ROLE_LABELS[mgr.role]}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="inline-flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={mgr.can_view}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          handleToggleManagerPerm(
                            mgr,
                            'canView',
                            e.target.checked
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                      />
                      Visualizar
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={mgr.can_manage_appointments}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          handleToggleManagerPerm(
                            mgr,
                            'canManageAppointments',
                            e.target.checked
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                      />
                      Agendar/Editar
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={mgr.can_manage_availability}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          handleToggleManagerPerm(
                            mgr,
                            'canManageAvailability',
                            e.target.checked
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                      />
                      Disponibilidade
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={mgr.can_manage_blocks}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          handleToggleManagerPerm(
                            mgr,
                            'canManageBlocks',
                            e.target.checked
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                      />
                      Bloqueios
                    </label>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleRemoveManager(mgr.id)}
                        aria-label={`Remover gestor ${mgr.manager_name}`}
                        className="cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isAdmin && (
            <form
              onSubmit={handleAddManager}
              className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4"
            >
              <input
                type="text"
                required
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                placeholder="Nome do gestor / recepção"
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-emerald-600"
              />
              <input
                type="email"
                required
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                placeholder="E-mail de acesso"
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-emerald-600"
              />
              <select
                value={managerRole}
                onChange={(e) => setManagerRole(e.target.value as MemberRole)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
              >
                <option value="reception">Recepção</option>
                <option value="delegated_manager">Gestor delegado</option>
                <option value="unit_manager">Gestor da unidade</option>
              </select>
              <button
                type="submit"
                disabled={savingManager}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {savingManager ? 'Vinculando...' : 'Adicionar gestor'}
              </button>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 sm:col-span-4">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={canView}
                    onChange={(e) => setCanView(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                  />
                  Pode visualizar
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={canManageAppointments}
                    onChange={(e) => setCanManageAppointments(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                  />
                  Pode criar/editar agendamentos
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={canManageAvailability}
                    onChange={(e) => setCanManageAvailability(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                  />
                  Pode configurar disponibilidade
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={canManageBlocks}
                    onChange={(e) => setCanManageBlocks(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                  />
                  Pode criar bloqueios
                </label>
              </div>
            </form>
          )}
        </section>
      )}

      {/* 4. Trilha de auditoria */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2.5 border-b border-slate-200 pb-4">
          <History className="h-5 w-5 text-slate-600" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Auditoria recente da agenda
            </h2>
            <p className="text-xs text-slate-500">
              Registro rastreável de criação, reagendamento, cancelamento e
              permissões.
            </p>
          </div>
        </div>

        {auditLogs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Nenhuma movimentação registrada ainda.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {auditLogs.slice(0, 20).map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900">
                    {AUDIT_LABELS[log.action] ?? log.action}
                  </span>
                  <span className="text-slate-500">
                    {' '}
                    · {log.actor_email ?? 'Sistema'}
                  </span>
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone,
                  }).format(new Date(log.created_at))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
