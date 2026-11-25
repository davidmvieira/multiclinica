'use client';

import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import { PROFESSIONAL_COLORS } from '@/lib/agenda/constants';
import type {
  AgendaProfessional,
  AgendaSpecialty,
  AgendaUnit,
} from '@/types/agenda';

interface ProfessionalModalProps {
  professional: AgendaProfessional | null;
  units: AgendaUnit[];
  specialties: AgendaSpecialty[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export default function ProfessionalModal({
  professional,
  units,
  specialties,
  onClose,
  onSaved,
}: ProfessionalModalProps) {
  const isEditing = Boolean(professional);

  const [name, setName] = useState(professional?.name ?? '');
  const [email, setEmail] = useState(professional?.email ?? '');
  const [unitId, setUnitId] = useState(
    professional?.unit_id ?? units[0]?.id ?? ''
  );
  const [color, setColor] = useState(
    professional?.color ?? PROFESSIONAL_COLORS[0].hex
  );
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(
    professional?.specialty_ids ??
      (specialties[0]?.id ? [specialties[0].id] : [])
  );
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(60);

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
    if (!name.trim()) {
      setError('Informe o nome do profissional.');
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
          unitId: unitId || null,
          color,
          specialtyIds,
          slotDurationMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar o profissional.');
        return;
      }
      await onSaved();
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
      aria-labelledby="prof-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <UserPlus
              className="h-5 w-5 text-emerald-600"
              aria-hidden="true"
            />
            <h2
              id="prof-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              {isEditing
                ? 'Editar profissional e agenda'
                : 'Novo profissional com agenda independente'}
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

          <div>
            <label
              htmlFor="prof-name"
              className="block text-sm font-medium text-slate-700"
            >
              Nome completo
            </label>
            <input
              id="prof-name"
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Dra. Marina Costa"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
            />
          </div>

          {!isEditing && (
            <div>
              <label
                htmlFor="prof-email"
                className="block text-sm font-medium text-slate-700"
              >
                E-mail (opcional)
              </label>
              <input
                id="prof-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="marina@clinica.com.br"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="prof-unit"
                className="block text-sm font-medium text-slate-700"
              >
                Unidade
              </label>
              <select
                id="prof-unit"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            {!isEditing && (
              <div>
                <label
                  htmlFor="prof-slot"
                  className="block text-sm font-medium text-slate-700"
                >
                  Duração padrão da sessão
                </label>
                <select
                  id="prof-slot"
                  value={slotDurationMinutes}
                  onChange={(e) =>
                    setSlotDurationMinutes(Number(e.target.value))
                  }
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                >
                  {[30, 45, 50, 60, 90].map((min) => (
                    <option key={min} value={min}>
                      {min} minutos
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700">
              Especialidades atendidas
            </span>
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

          <div className="flex justify-end gap-2.5 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
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
