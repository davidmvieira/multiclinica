'use client';

import { AlertTriangle, CheckCircle2, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  ALT_IDENTIFIER_TYPES,
  PATIENT_STATUS_LIST,
  PATIENT_STATUS_META,
  formatCpf,
  isValidCpf,
  normalizeCpfDigits,
} from '@/lib/patients/constants';
import type {
  PatientOperationalStatus,
  PatientRecord,
} from '@/types/patients';

interface PatientFormModalProps {
  patient: PatientRecord | null;
  existingPatients: PatientRecord[];
  onClose: () => void;
  onSaved: (saved: PatientRecord, isNew: boolean) => void;
  onOpenExistingPatient?: (patientId: string) => void;
}

export default function PatientFormModal({
  patient,
  existingPatients,
  onClose,
  onSaved,
  onOpenExistingPatient,
}: PatientFormModalProps) {
  const isEditing = Boolean(patient);

  const [name, setName] = useState(patient?.name ?? '');
  const [socialName, setSocialName] = useState(patient?.social_name ?? '');
  const [status, setStatus] = useState<PatientOperationalStatus>(
    patient?.status ?? 'em_avaliacao'
  );
  const [hasNoCpf, setHasNoCpf] = useState(
    patient ? patient.has_no_cpf && !patient.cpf_digits : false
  );
  const [cpf, setCpf] = useState(patient?.cpf ? formatCpf(patient.cpf) : '');
  const [altIdentifierType, setAltIdentifierType] = useState(
    patient?.alt_identifier_type ?? 'RG'
  );
  const [altIdentifierValue, setAltIdentifierValue] = useState(
    patient?.alt_identifier_value ?? ''
  );
  const [birthDate, setBirthDate] = useState(patient?.birth_date ?? '');
  const [gender, setGender] = useState(patient?.gender ?? '');

  const [phone, setPhone] = useState(patient?.phone ?? '');
  const [secondaryPhone, setSecondaryPhone] = useState(
    patient?.secondary_phone ?? ''
  );
  const [email, setEmail] = useState(patient?.email ?? '');

  const [addressZip, setAddressZip] = useState(patient?.address_zip ?? '');
  const [addressStreet, setAddressStreet] = useState(
    patient?.address_street ?? ''
  );
  const [addressNumber, setAddressNumber] = useState(
    patient?.address_number ?? ''
  );
  const [addressComplement, setAddressComplement] = useState(
    patient?.address_complement ?? ''
  );
  const [addressNeighborhood, setAddressNeighborhood] = useState(
    patient?.address_neighborhood ?? ''
  );
  const [addressCity, setAddressCity] = useState(patient?.address_city ?? '');
  const [addressState, setAddressState] = useState(patient?.address_state ?? '');

  const [legalGuardianName, setLegalGuardianName] = useState(
    patient?.legal_guardian_name ?? ''
  );
  const [legalGuardianRelationship, setLegalGuardianRelationship] = useState(
    patient?.legal_guardian_relationship ?? ''
  );
  const [legalGuardianPhone, setLegalGuardianPhone] = useState(
    patient?.legal_guardian_phone ?? ''
  );
  const [legalGuardianCpf, setLegalGuardianCpf] = useState(
    patient?.legal_guardian_cpf ? formatCpf(patient.legal_guardian_cpf) : ''
  );

  const [emergencyContactName, setEmergencyContactName] = useState(
    patient?.emergency_contact_name ?? ''
  );
  const [emergencyContactRelationship, setEmergencyContactRelationship] =
    useState(patient?.emergency_contact_relationship ?? '');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    patient?.emergency_contact_phone ?? ''
  );

  const [notes, setNotes] = useState(patient?.notes ?? '');
  const [auditReason, setAuditReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverDuplicate, setServerDuplicate] = useState<{
    id: string;
    name: string;
    cpf: string | null;
    phone: string | null;
    status: string;
  } | null>(null);

  const cpfDigits = normalizeCpfDigits(cpf);

  const clientDuplicate = useMemo(() => {
    if (hasNoCpf || cpfDigits.length !== 11) return null;
    return (
      existingPatients.find(
        (p) =>
          p.id !== patient?.id &&
          normalizeCpfDigits(p.cpf_digits ?? p.cpf) === cpfDigits
      ) ?? null
    );
  }, [hasNoCpf, cpfDigits, existingPatients, patient?.id]);

  const activeDuplicate = serverDuplicate ?? clientDuplicate;
  const cpfInvalid =
    !hasNoCpf && cpfDigits.length === 11 && !isValidCpf(cpfDigits);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setServerDuplicate(null);

    if (name.trim().length < 2) {
      setError('Informe o nome completo do paciente.');
      return;
    }

    if (!hasNoCpf && cpfDigits.length > 0 && !isValidCpf(cpfDigits)) {
      setError('O CPF informado é inválido. Confira os 11 dígitos.');
      return;
    }

    if (activeDuplicate) {
      setError(
        `Já existe um paciente cadastrado com este CPF nesta clínica (${activeDuplicate.name}).`
      );
      return;
    }

    const guardianDigits = normalizeCpfDigits(legalGuardianCpf);
    if (guardianDigits.length > 0 && !isValidCpf(guardianDigits)) {
      setError('O CPF do responsável legal é inválido.');
      return;
    }

    setSubmitting(true);
    try {
      const url = isEditing ? `/api/patients/${patient!.id}` : '/api/patients';
      const method = isEditing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          socialName: socialName.trim() || null,
          status,
          hasNoCpf,
          cpf: hasNoCpf ? null : cpfDigits ? formatCpf(cpfDigits) : null,
          altIdentifierType: altIdentifierValue.trim()
            ? altIdentifierType
            : null,
          altIdentifierValue: altIdentifierValue.trim() || null,
          birthDate: birthDate || null,
          gender: gender || null,
          phone: phone.trim() || null,
          secondaryPhone: secondaryPhone.trim() || null,
          email: email.trim() || null,
          addressZip: addressZip.trim() || null,
          addressStreet: addressStreet.trim() || null,
          addressNumber: addressNumber.trim() || null,
          addressComplement: addressComplement.trim() || null,
          addressNeighborhood: addressNeighborhood.trim() || null,
          addressCity: addressCity.trim() || null,
          addressState: addressState.trim() || null,
          legalGuardianName: legalGuardianName.trim() || null,
          legalGuardianRelationship: legalGuardianRelationship.trim() || null,
          legalGuardianPhone: legalGuardianPhone.trim() || null,
          legalGuardianCpf: guardianDigits ? formatCpf(guardianDigits) : null,
          emergencyContactName: emergencyContactName.trim() || null,
          emergencyContactRelationship:
            emergencyContactRelationship.trim() || null,
          emergencyContactPhone: emergencyContactPhone.trim() || null,
          notes: notes.trim() || null,
          auditReason: auditReason.trim() || null,
        }),
      });

      const data = await res.json();
      if (res.status === 409 && data.code === 'DUPLICATE_CPF') {
        setServerDuplicate(data.existingPatient ?? null);
        setError(
          data.error ??
            'Já existe um paciente cadastrado com este CPF nesta organização.'
        );
        return;
      }

      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar o cadastro.');
        return;
      }

      onSaved(data.patient as PatientRecord, !isEditing);
    } catch {
      setError('Falha de conexão ao salvar os dados do paciente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patient-modal-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <UserPlus className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            <div>
              <h2
                id="patient-modal-title"
                className="text-lg font-bold text-slate-900"
              >
                {isEditing ? 'Editar dados do paciente' : 'Novo paciente'}
              </h2>
              <p className="text-xs text-slate-500">
                {isEditing
                  ? 'Toda alteração cadastral gera um registro auditável automático.'
                  : 'Cadastro único por clínica com verificação automática de CPF.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 space-y-6 overflow-y-auto px-6 py-5"
        >
          {/* Duplicate CPF Alert */}
          {activeDuplicate && (
            <div
              role="alert"
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <p className="font-semibold">
                    Alerta de duplicidade: CPF já cadastrado nesta clínica
                  </p>
                  <p className="mt-1 text-xs text-amber-900">
                    Paciente localizado:{' '}
                    <strong className="font-semibold">
                      {activeDuplicate.name}
                    </strong>
                    {activeDuplicate.cpf ? ` · CPF ${activeDuplicate.cpf}` : ''}
                    {activeDuplicate.phone ? ` · ${activeDuplicate.phone}` : ''}
                  </p>
                  {onOpenExistingPatient && (
                    <button
                      type="button"
                      onClick={() => onOpenExistingPatient(activeDuplicate.id)}
                      className="mt-3 inline-flex h-8 cursor-pointer items-center rounded-lg border border-amber-400 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-100 whitespace-nowrap"
                    >
                      Abrir prontuário existente
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && !activeDuplicate && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {/* Section 1: Identification & Operational Status */}
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Identificação e situação operacional
            </legend>

            <div className="grid gap-4 sm:grid-cols-12">
              <div className="sm:col-span-7">
                <label
                  htmlFor="patient-name"
                  className="block text-sm font-medium text-slate-700"
                >
                  Nome completo *
                </label>
                <input
                  id="patient-name"
                  type="text"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Sofia Lima"
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>

              <div className="sm:col-span-5">
                <label
                  htmlFor="patient-status"
                  className="block text-sm font-medium text-slate-700"
                >
                  Situação operacional *
                </label>
                <select
                  id="patient-status"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as PatientOperationalStatus)
                  }
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                >
                  {PATIENT_STATUS_LIST.map((st) => (
                    <option key={st} value={st}>
                      {PATIENT_STATUS_META[st].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <label
                  htmlFor="patient-social-name"
                  className="block text-sm font-medium text-slate-700"
                >
                  Nome social (opcional)
                </label>
                <input
                  id="patient-social-name"
                  type="text"
                  maxLength={120}
                  value={socialName}
                  onChange={(e) => setSocialName(e.target.value)}
                  placeholder="Como prefere ser chamado"
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>

              <div className="sm:col-span-4">
                <label
                  htmlFor="patient-birth-date"
                  className="block text-sm font-medium text-slate-700"
                >
                  Data de nascimento
                </label>
                <input
                  id="patient-birth-date"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="patient-gender"
                  className="block text-sm font-medium text-slate-700"
                >
                  Sexo / Gênero
                </label>
                <select
                  id="patient-gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                >
                  <option value="">Não informado</option>
                  <option value="Feminino">Feminino</option>
                  <option value="Masculino">Masculino</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="patient-cpf"
                  className="text-sm font-medium text-slate-800"
                >
                  Documento principal (CPF)
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={hasNoCpf}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setHasNoCpf(next);
                      if (next) {
                        setCpf('');
                        setServerDuplicate(null);
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  Paciente sem CPF (usar documento alternativo ou responsável
                  legal)
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <input
                    id="patient-cpf"
                    type="text"
                    inputMode="numeric"
                    disabled={hasNoCpf}
                    value={cpf}
                    onChange={(e) => {
                      setServerDuplicate(null);
                      setCpf(formatCpf(e.target.value));
                    }}
                    placeholder="000.000.000-00"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-400 tabular-nums"
                  />
                  {cpfInvalid && (
                    <p className="mt-1 text-xs text-red-700">
                      CPF com dígito verificador inválido.
                    </p>
                  )}
                  {!hasNoCpf &&
                    cpfDigits.length === 11 &&
                    !cpfInvalid &&
                    !activeDuplicate && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        CPF válido e disponível na clínica
                      </p>
                    )}
                </div>

                <div className="sm:col-span-4">
                  <select
                    aria-label="Tipo de identificador alternativo"
                    value={altIdentifierType}
                    onChange={(e) => setAltIdentifierType(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                  >
                    {ALT_IDENTIFIER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <input
                    type="text"
                    aria-label="Número do identificador alternativo"
                    maxLength={80}
                    value={altIdentifierValue}
                    onChange={(e) => setAltIdentifierValue(e.target.value)}
                    placeholder="Nº do documento alternativo"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                  />
                </div>
              </div>
            </div>
          </fieldset>

          {/* Section 2: Contacts & Address */}
          <fieldset className="space-y-4 border-t border-slate-200 pt-5">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Contatos e endereço
            </legend>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="patient-phone"
                  className="block text-sm font-medium text-slate-700"
                >
                  Telefone / WhatsApp
                </label>
                <input
                  id="patient-phone"
                  type="tel"
                  maxLength={32}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 99999-0000"
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>
              <div>
                <label
                  htmlFor="patient-phone-2"
                  className="block text-sm font-medium text-slate-700"
                >
                  Telefone secundário
                </label>
                <input
                  id="patient-phone-2"
                  type="tel"
                  maxLength={32}
                  value={secondaryPhone}
                  onChange={(e) => setSecondaryPhone(e.target.value)}
                  placeholder="(11) 3333-0000"
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>
              <div>
                <label
                  htmlFor="patient-email"
                  className="block text-sm font-medium text-slate-700"
                >
                  E-mail
                </label>
                <input
                  id="patient-email"
                  type="email"
                  maxLength={160}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="paciente@email.com"
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-12">
              <div className="sm:col-span-3">
                <label
                  htmlFor="patient-zip"
                  className="block text-xs font-medium text-slate-600"
                >
                  CEP
                </label>
                <input
                  id="patient-zip"
                  type="text"
                  maxLength={16}
                  value={addressZip}
                  onChange={(e) => setAddressZip(e.target.value)}
                  placeholder="00000-000"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>
              <div className="sm:col-span-6">
                <label
                  htmlFor="patient-street"
                  className="block text-xs font-medium text-slate-600"
                >
                  Logradouro
                </label>
                <input
                  id="patient-street"
                  type="text"
                  maxLength={160}
                  value={addressStreet}
                  onChange={(e) => setAddressStreet(e.target.value)}
                  placeholder="Rua / Avenida"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-3">
                <label
                  htmlFor="patient-number"
                  className="block text-xs font-medium text-slate-600"
                >
                  Número
                </label>
                <input
                  id="patient-number"
                  type="text"
                  maxLength={24}
                  value={addressNumber}
                  onChange={(e) => setAddressNumber(e.target.value)}
                  placeholder="123"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-4">
                <label
                  htmlFor="patient-neighborhood"
                  className="block text-xs font-medium text-slate-600"
                >
                  Bairro
                </label>
                <input
                  id="patient-neighborhood"
                  type="text"
                  maxLength={80}
                  value={addressNeighborhood}
                  onChange={(e) => setAddressNeighborhood(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-4">
                <label
                  htmlFor="patient-city"
                  className="block text-xs font-medium text-slate-600"
                >
                  Cidade
                </label>
                <input
                  id="patient-city"
                  type="text"
                  maxLength={80}
                  value={addressCity}
                  onChange={(e) => setAddressCity(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="patient-state"
                  className="block text-xs font-medium text-slate-600"
                >
                  UF
                </label>
                <input
                  id="patient-state"
                  type="text"
                  maxLength={2}
                  value={addressState}
                  onChange={(e) => setAddressState(e.target.value.toUpperCase())}
                  placeholder="SP"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="patient-complement"
                  className="block text-xs font-medium text-slate-600"
                >
                  Compl.
                </label>
                <input
                  id="patient-complement"
                  type="text"
                  maxLength={80}
                  value={addressComplement}
                  onChange={(e) => setAddressComplement(e.target.value)}
                  placeholder="Apto"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          </fieldset>

          {/* Section 3: Legal Guardian & Emergency Contact */}
          <fieldset className="space-y-4 border-t border-slate-200 pt-5">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Contato de emergência e responsável legal
            </legend>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="emergency-name"
                  className="block text-xs font-medium text-slate-700"
                >
                  Contato de emergência (Nome)
                </label>
                <input
                  id="emergency-name"
                  type="text"
                  maxLength={120}
                  value={emergencyContactName}
                  onChange={(e) => setEmergencyContactName(e.target.value)}
                  placeholder="Nome completo"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label
                  htmlFor="emergency-rel"
                  className="block text-xs font-medium text-slate-700"
                >
                  Vínculo / Parentesco
                </label>
                <input
                  id="emergency-rel"
                  type="text"
                  maxLength={60}
                  value={emergencyContactRelationship}
                  onChange={(e) =>
                    setEmergencyContactRelationship(e.target.value)
                  }
                  placeholder="Ex.: Cônjuge, Mãe, Filho(a)"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label
                  htmlFor="emergency-phone"
                  className="block text-xs font-medium text-slate-700"
                >
                  Telefone de emergência
                </label>
                <input
                  id="emergency-phone"
                  type="tel"
                  maxLength={32}
                  value={emergencyContactPhone}
                  onChange={(e) => setEmergencyContactPhone(e.target.value)}
                  placeholder="(11) 98888-0000"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <label
                  htmlFor="guardian-name"
                  className="block text-xs font-medium text-slate-700"
                >
                  Responsável legal (se aplicável)
                </label>
                <input
                  id="guardian-name"
                  type="text"
                  maxLength={120}
                  value={legalGuardianName}
                  onChange={(e) => setLegalGuardianName(e.target.value)}
                  placeholder="Nome do responsável"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-3">
                <label
                  htmlFor="guardian-rel"
                  className="block text-xs font-medium text-slate-700"
                >
                  Parentesco
                </label>
                <input
                  id="guardian-rel"
                  type="text"
                  maxLength={60}
                  value={legalGuardianRelationship}
                  onChange={(e) => setLegalGuardianRelationship(e.target.value)}
                  placeholder="Ex.: Pai, Mãe, Tutor"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="guardian-phone"
                  className="block text-xs font-medium text-slate-700"
                >
                  Telefone
                </label>
                <input
                  id="guardian-phone"
                  type="tel"
                  maxLength={32}
                  value={legalGuardianPhone}
                  onChange={(e) => setLegalGuardianPhone(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>
              <div className="sm:col-span-3">
                <label
                  htmlFor="guardian-cpf"
                  className="block text-xs font-medium text-slate-700"
                >
                  CPF do responsável
                </label>
                <input
                  id="guardian-cpf"
                  type="text"
                  inputMode="numeric"
                  value={legalGuardianCpf}
                  onChange={(e) =>
                    setLegalGuardianCpf(formatCpf(e.target.value))
                  }
                  placeholder="000.000.000-00"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>
            </div>
          </fieldset>

          {/* Section 4: Notes & Audit Justification */}
          <fieldset className="space-y-3 border-t border-slate-200 pt-5">
            <div>
              <label
                htmlFor="patient-notes"
                className="block text-sm font-medium text-slate-700"
              >
                Observações administrativas
              </label>
              <textarea
                id="patient-notes"
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Preferências de horário, convênio ou observações cadastrais..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            {isEditing && (
              <div>
                <label
                  htmlFor="patient-audit-reason"
                  className="block text-sm font-medium text-slate-700"
                >
                  Motivo da alteração cadastral (auditoria)
                </label>
                <input
                  id="patient-audit-reason"
                  type="text"
                  maxLength={300}
                  value={auditReason}
                  onChange={(e) => setAuditReason(e.target.value)}
                  placeholder="Ex.: Atualização de telefone solicitada pelo paciente"
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
            )}
          </fieldset>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(activeDuplicate) || cpfInvalid}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {submitting
                ? 'Salvando...'
                : isEditing
                  ? 'Salvar alterações'
                  : 'Cadastrar paciente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
