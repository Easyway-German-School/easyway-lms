import CampusLobbyView from "@/components/campus/CampusLobbyView";
import StudentShell from "@/components/StudentShell";

export default function CampusPage() {
  return (
    <StudentShell>
      <CampusLobbyView />
    </StudentShell>
  );
}
