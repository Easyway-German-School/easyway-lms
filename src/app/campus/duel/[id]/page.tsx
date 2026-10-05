import DuelView from "@/components/campus/DuelView";
import StudentShell from "@/components/StudentShell";

export default async function DuelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <StudentShell>
      <DuelView id={id} />
    </StudentShell>
  );
}
