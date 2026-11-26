import type { SupabaseClient } from '@supabase/supabase-js';

import type { MemberRole } from '@/types/agenda';
import type {
  PatientOperationalStatus,
  PatientRecord,
} from '@/types/patients';
import {
  formatCpf,
  isValidCpf,
  isValidPatientStatus,
  normalizeCpfDigits,
} from '@/lib/patients/constants';

export const PATIENT_SELECT_FIELDS = [
  'id',
  'organization_id',
  'name',
  'social_name',
  'cpf',
  'cpf_digits',
  'has_no_cpf',
  'alt_identifier_type',
  'alt_identifier_value',
  'birth_date',
  'gender',
  'phone',
  'secondary_phone',
  'email',
  'address_zip',
  'address_street',
  'address_number',
  'address_complement',
  'address_neighborhood',
  'address_city',
  'address_state',
  'legal_guardian_name',
  'legal_guardian_relationship',
  'legal_guardian_phone',
  'legal_guardian_cpf',
  'emergency_contact_name',
  'emergency_contact_relationship',
  'emergency_contact_phone',
  'status',
  'notes',
  'created_at',
  'updated_at',
].join(', ');

export async function canUserAuthorClinicalRecord(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  role: MemberRole,
  isOwner: boolean
): Promise<boolean> {
  if (
    isOwner ||
    role === 'admin' ||
    role === 'unit_manager' ||
    role === 'professional'
  ) {
    return true;
  }

  const { data: prof } = await supabase
    .from('professionals')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  return Boolean(prof?.id);
}

function cleanText(
  value: unknown,
  maxLength = 160
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export interface ValidatedPatientPayload {
  name: string;
  social_name: string | null;
  cpf: string | null;
  cpf_digits: string | null;
  has_no_cpf: boolean;
  alt_identifier_type: string | null;
  alt_identifier_value: string | null;
  birth_date: string | null;
  gender: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  address_zip: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  legal_guardian_name: string | null;
  legal_guardian_relationship: string | null;
  legal_guardian_phone: string | null;
  legal_guardian_cpf: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  status: PatientOperationalStatus;
  notes: string | null;
}

export function validatePatientPayload(
  body: Record<string, unknown>,
  fallbackStatus: PatientOperationalStatus = 'em_avaliacao'
):
  | { ok: true; data: ValidatedPatientPayload; reason: string | null }
  | { ok: false; error: string } {
  const name = cleanText(body.name, 120);
  if (!name || name.length < 2) {
    return {
      ok: false,
      error: 'Informe o nome completo do paciente (mínimo 2 caracteres).',
    };
  }

  const rawCpf = cleanText(body.cpf, 20);
  const cpfDigits = normalizeCpfDigits(rawCpf);
  const hasNoCpf = Boolean(body.hasNoCpf ?? body.has_no_cpf) || !cpfDigits;

  if (cpfDigits) {
    if (!isValidCpf(cpfDigits)) {
      return {
        ok: false,
        error: 'O CPF informado é inválido. Verifique os 11 dígitos.',
      };
    }
  }

  const rawGuardianCpf = cleanText(
    body.legalGuardianCpf ?? body.legal_guardian_cpf,
    20
  );
  const guardianCpfDigits = normalizeCpfDigits(rawGuardianCpf);
  if (guardianCpfDigits && !isValidCpf(guardianCpfDigits)) {
    return {
      ok: false,
      error: 'O CPF do responsável legal é inválido.',
    };
  }

  const emailRaw = cleanText(body.email, 160);
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Informe um endereço de e-mail válido.' };
  }

  const birthDate = cleanText(body.birthDate ?? body.birth_date, 20);
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return {
      ok: false,
      error: 'Data de nascimento inválida (use o formato AAAA-MM-DD).',
    };
  }

  const statusInput = body.status ?? fallbackStatus;
  if (!isValidPatientStatus(statusInput)) {
    return {
      ok: false,
      error: 'Situação operacional do paciente inválida.',
    };
  }

  const altIdentifierType = cleanText(
    body.altIdentifierType ?? body.alt_identifier_type,
    60
  );
  const altIdentifierValue = cleanText(
    body.altIdentifierValue ?? body.alt_identifier_value,
    80
  );
  const legalGuardianName = cleanText(
    body.legalGuardianName ?? body.legal_guardian_name,
    120
  );

  const rawState = cleanText(body.addressState ?? body.address_state, 4);

  return {
    ok: true,
    data: {
      name,
      social_name: cleanText(body.socialName ?? body.social_name, 120),
      cpf: cpfDigits ? formatCpf(cpfDigits) : null,
      cpf_digits: cpfDigits || null,
      has_no_cpf: hasNoCpf,
      alt_identifier_type: altIdentifierValue ? altIdentifierType : null,
      alt_identifier_value: altIdentifierValue,
      birth_date: birthDate,
      gender: cleanText(body.gender, 40),
      phone: cleanText(body.phone, 32),
      secondary_phone: cleanText(
        body.secondaryPhone ?? body.secondary_phone,
        32
      ),
      email,
      address_zip: cleanText(body.addressZip ?? body.address_zip, 16),
      address_street: cleanText(body.addressStreet ?? body.address_street, 160),
      address_number: cleanText(body.addressNumber ?? body.address_number, 24),
      address_complement: cleanText(
        body.addressComplement ?? body.address_complement,
        80
      ),
      address_neighborhood: cleanText(
        body.addressNeighborhood ?? body.address_neighborhood,
        80
      ),
      address_city: cleanText(body.addressCity ?? body.address_city, 80),
      address_state: rawState ? rawState.toUpperCase() : null,
      legal_guardian_name: legalGuardianName,
      legal_guardian_relationship: cleanText(
        body.legalGuardianRelationship ?? body.legal_guardian_relationship,
        60
      ),
      legal_guardian_phone: cleanText(
        body.legalGuardianPhone ?? body.legal_guardian_phone,
        32
      ),
      legal_guardian_cpf: guardianCpfDigits
        ? formatCpf(guardianCpfDigits)
        : null,
      emergency_contact_name: cleanText(
        body.emergencyContactName ?? body.emergency_contact_name,
        120
      ),
      emergency_contact_relationship: cleanText(
        body.emergencyContactRelationship ??
          body.emergency_contact_relationship,
        60
      ),
      emergency_contact_phone: cleanText(
        body.emergencyContactPhone ?? body.emergency_contact_phone,
        32
      ),
      status: statusInput,
      notes: cleanText(body.notes, 2000),
    },
    reason: cleanText(body.auditReason ?? body.reason, 300),
  };
}

export async function findDuplicatePatientByCpf(
  supabase: SupabaseClient,
  organizationId: string,
  cpfDigits: string,
  excludePatientId?: string
): Promise<Pick<
  PatientRecord,
  'id' | 'name' | 'cpf' | 'phone' | 'status'
> | null> {
  if (!cpfDigits) return null;

  let query = supabase
    .from('patients')
    .select('id, name, cpf, phone, status')
    .eq('organization_id', organizationId)
    .eq('cpf_digits', cpfDigits)
    .limit(1);

  if (excludePatientId) {
    query = query.neq('id', excludePatientId);
  }

  const { data, error } = await query.maybeSingle();
  if (!error && data) {
    return data as Pick<PatientRecord, 'id' | 'name' | 'cpf' | 'phone' | 'status'>;
  }

  return null;
}

export function normalizeLegacyPatientRow(
  row: Record<string, unknown>
): PatientRecord {
  const statusVal = row.status;
  return {
    id: String(row.id),
    organization_id: String(row.organization_id ?? ''),
    name: String(row.name ?? row.full_name ?? 'Paciente'),
    social_name: (row.social_name as string | null) ?? null,
    cpf: (row.cpf as string | null) ?? null,
    cpf_digits: (row.cpf_digits as string | null) ?? null,
    has_no_cpf: Boolean(row.has_no_cpf ?? !row.cpf),
    alt_identifier_type: (row.alt_identifier_type as string | null) ?? null,
    alt_identifier_value: (row.alt_identifier_value as string | null) ?? null,
    birth_date: (row.birth_date as string | null) ?? null,
    gender: (row.gender as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    secondary_phone: (row.secondary_phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    address_zip: (row.address_zip as string | null) ?? null,
    address_street: (row.address_street as string | null) ?? null,
    address_number: (row.address_number as string | null) ?? null,
    address_complement: (row.address_complement as string | null) ?? null,
    address_neighborhood: (row.address_neighborhood as string | null) ?? null,
    address_city: (row.address_city as string | null) ?? null,
    address_state: (row.address_state as string | null) ?? null,
    legal_guardian_name: (row.legal_guardian_name as string | null) ?? null,
    legal_guardian_relationship:
      (row.legal_guardian_relationship as string | null) ?? null,
    legal_guardian_phone: (row.legal_guardian_phone as string | null) ?? null,
    legal_guardian_cpf: (row.legal_guardian_cpf as string | null) ?? null,
    emergency_contact_name:
      (row.emergency_contact_name as string | null) ?? null,
    emergency_contact_relationship:
      (row.emergency_contact_relationship as string | null) ?? null,
    emergency_contact_phone:
      (row.emergency_contact_phone as string | null) ?? null,
    status: isValidPatientStatus(statusVal) ? statusVal : 'em_avaliacao',
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(
      row.updated_at ?? row.created_at ?? new Date().toISOString()
    ),
  };
}
