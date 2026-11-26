import PatientDetailWorkspace from '@/components/patients/patient-detail-workspace';

export const dynamic = 'force-dynamic';

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PatientDetailWorkspace patientId={id} />;
}
