'use client';

import { Building2, X } from 'lucide-react';
import { useState } from 'react';

import type { SettingsUnit } from '@/types/settings';

interface UnitModalProps {
  unit: SettingsUnit | null;
  onClose: () => void;
  onSaved: (notice?: string) => Promise<void>;
}

const BRAZIL_TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo (UTC-3)' },
  { value: 'America/Fortaleza', label: 'Nordeste / Fortaleza (UTC-3)' },
  { value: 'America/Belem', label: 'Belém / Pará (UTC-3)' },
  { value: 'America/Manaus', label: 'Manaus / Amazonas (UTC-4)' },
  { value: 'America/Cuiaba', label: 'Cuiabá / Mato Grosso (UTC-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco / Acre (UTC-5)' },
];

export default function UnitModal({ unit, onClose, onSaved }: UnitModalProps) {
  const isEditing = Boolean(unit);

  const [name, setName] = useState(unit?.name ?? '');
  const [address, setAddress] = useState(unit?.address ?? '');
  const [phone, setPhone] = useState(unit?.phone ?? '');
  const [timezone, setTimezone] = useState(
    unit?.timezone ?? 'America/Sao_Paulo'
  );
  const [isActive, setIsActive] = useState(unit?.is_active ?? true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) {
      setError('Informe o nome da unidade (pelo menos 2 caracteres).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/settings/units', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: unit?.id,
          name: name.trim(),
          address: address.trim(),
          phone: phone.trim(),
          timezone,
          isActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar a unidade.');
        return;
      }

      await onSaved(
        isEditing
          ? 'Unidade atualizada com sucesso.'
          : 'Nova unidade cadastrada.'
      );
      onClose();
    } catch {
      setError('Falha de conexão ao salvar a unidade.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unit-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2
              id="unit-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              {isEditing ? 'Editar unidade' : 'Nova unidade de atendimento'}
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
              htmlFor="unit-name"
              className="block text-sm font-medium text-slate-700"
            >
              Nome da unidade
            </label>
            <input
              id="unit-name"
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Unidade Jardins"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label
              htmlFor="unit-address"
              className="block text-sm font-medium text-slate-700"
            >
              Endereço completo (opcional)
            </label>
            <input
              id="unit-address"
              type="text"
              maxLength={240}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ex.: Rua Oscar Freire, 450 — São Paulo/SP"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="unit-phone"
                className="block text-sm font-medium text-slate-700"
              >
                Telefone / Recepção (opcional)
              </label>
              <input
                id="unit-phone"
                type="text"
                maxLength={40}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 3000-1000"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="unit-timezone"
                className="block text-sm font-medium text-slate-700"
              >
                Fuso horário
              </label>
              <select
                id="unit-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              >
                {BRAZIL_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
            />
            <span>Unidade ativa para novos agendamentos</span>
          </label>

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
                  ? 'Salvar unidade'
                  : 'Cadastrar unidade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
