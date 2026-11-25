'use client';

import { Lock, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { buildZonedIso, getZonedParts } from '@/lib/agenda/constants';
import type {
  AgendaBlock,
  AgendaProfessional,
  AgendaSchedule,
  SchedulePermissionFlags,
} from '@/types/agenda';

interface BlockModalProps {
  timeZone: string;
  isAdmin: boolean;
  initialDateStr?: string;
  professionals: AgendaProfessional[];
  schedules: AgendaSchedule[];
  blocks: AgendaBlock[];
  permissionsBySchedule: Record<string, SchedulePermissionFlags>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const PRESET_TITLES = [
  'Clínica fechada',
  'Intervalo de almoço',
  'Reunião de equipe',
  'Férias / Ausência',
];

export default function BlockModal({
  timeZone,
  isAdmin,
  initialDateStr,
  professionals,
  schedules,
  blocks,
  permissionsBySchedule,
  onClose,
  onSaved,
}: BlockModalProps) {
  const blockableSchedules = schedules.filter(
    (s) => permissionsBySchedule[s.id]?.can_manage_blocks
  );

  const [scopeScheduleId, setScopeScheduleId] = useState(
    isAdmin ? '' : blockableSchedules[0]?.id ?? ''
  );
  const [title, setTitle] = useState('Clínica fechada');
  const [reason, setReason] = useState('');
  const [dateStr, setDateStr] = useState(
    initialDateStr ?? getZonedParts(new Date(), timeZone).dateStr
  );
  const [startTime, setStartTime] = useState('12:00');
  const [endTime, setEndTime] = useState('13:00');
  const [isRecurring, setIsRecurring] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const startsAt = buildZonedIso(dateStr, startTime, timeZone);
    const endsAt = buildZonedIso(dateStr, endTime, timeZone);

    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      setError('O horário final do bloqueio deve ser posterior ao inicial.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/agenda/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: scopeScheduleId || null,
          title: title.trim(),
          reason: reason.trim() || null,
          startsAt,
          endsAt,
          isRecurring,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível criar o bloqueio.');
        return;
      }
      await onSaved();
      onClose();
    } catch {
      setError('Falha de conexão ao criar bloqueio.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(blockId: string) {
    setError(null);
    setDeletingId(blockId);
    try {
      const res = await fetch(
        `/api/agenda/blocks?id=${encodeURIComponent(blockId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível remover o bloqueio.');
        return;
      }
      await onSaved();
    } catch {
      setError('Falha de conexão ao remover bloqueio.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="block-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Lock className="h-5 w-5 text-slate-700" aria-hidden="true" />
            <h2
              id="block-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              Bloqueios e ausências
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

        <div className="space-y-6 p-6">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Modelos rápidos
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESET_TITLES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTitle(preset)}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      title === preset
                        ? 'border-slate-800 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="block-scope"
                  className="block text-sm font-medium text-slate-700"
                >
                  Aplicar bloqueio em
                </label>
                <select
                  id="block-scope"
                  value={scopeScheduleId}
                  onChange={(e) => setScopeScheduleId(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                >
                  {isAdmin && (
                    <option value="">Toda a clínica (todas as agendas)</option>
                  )}
                  {blockableSchedules.map((sched) => {
                    const prof = professionals.find(
                      (p) => p.id === sched.professional_id
                    );
                    return (
                      <option key={sched.id} value={sched.id}>
                        {prof?.name ?? sched.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label
                  htmlFor="block-title"
                  className="block text-sm font-medium text-slate-700"
                >
                  Título exibido na grade
                </label>
                <input
                  id="block-title"
                  type="text"
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="block-date"
                  className="block text-sm font-medium text-slate-700"
                >
                  Data
                </label>
                <input
                  id="block-date"
                  type="date"
                  required
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label
                  htmlFor="block-start"
                  className="block text-sm font-medium text-slate-700"
                >
                  Início
                </label>
                <input
                  id="block-start"
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label
                  htmlFor="block-end"
                  className="block text-sm font-medium text-slate-700"
                >
                  Término
                </label>
                <input
                  id="block-end"
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="block-reason"
                className="block text-sm font-medium text-slate-700"
              >
                Motivo (opcional)
              </label>
              <input
                id="block-reason"
                type="text"
                maxLength={250}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Feriado municipal, manutenção da sala..."
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="block-recurring"
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
              />
              <label
                htmlFor="block-recurring"
                className="text-sm text-slate-700"
              >
                Repetir diariamente neste mesmo horário
              </label>
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {submitting ? 'Bloqueando...' : 'Criar bloqueio'}
              </button>
            </div>
          </form>

          {blocks.length > 0 && (
            <div className="border-t border-slate-200 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Bloqueios cadastrados ({blocks.length})
              </h3>
              <ul className="mt-3 space-y-2">
                {blocks.map((block) => {
                  const start = getZonedParts(block.starts_at, timeZone);
                  const end = getZonedParts(block.ends_at, timeZone);
                  const sched = block.schedule_id
                    ? schedules.find((s) => s.id === block.schedule_id)
                    : null;
                  const prof = sched
                    ? professionals.find((p) => p.id === sched.professional_id)
                    : null;
                  const canDelete = block.schedule_id
                    ? permissionsBySchedule[block.schedule_id]?.can_manage_blocks
                    : isAdmin;

                  return (
                    <li
                      key={block.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {block.title}
                        </p>
                        <p className="font-mono text-xs text-slate-600 tabular-nums">
                          {block.is_recurring
                            ? `Diário · ${start.timeStr}–${end.timeStr}`
                            : `${start.dateStr.split('-').reverse().join('/')} · ${start.timeStr}–${end.timeStr}`}{' '}
                          · {prof ? prof.name : 'Toda a clínica'}
                        </p>
                      </div>
                      {canDelete && (
                        <button
                          type="button"
                          disabled={deletingId === block.id}
                          onClick={() => handleDelete(block.id)}
                          aria-label={`Remover bloqueio ${block.title}`}
                          className="cursor-pointer rounded-md p-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
