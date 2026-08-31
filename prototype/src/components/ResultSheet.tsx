import type { ResultSheet as ResultSheetData } from "@/lib/result-sheet";

/**
 * The printable result sheet, shared by the student's own copy (`/results/sheet`)
 * and the office copy (`/admin/students/[id]/sheet`). Presentational only — the
 * numbers are computed once in `lib/result-sheet.ts` so the two copies cannot
 * disagree.
 *
 * `@page` is A4 portrait; `.result-sheet` carries its own light palette so a
 * student who prints in Nacht/Dämmerung theme still gets black-on-white paper.
 */

function labelFor(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ResultSheet({ sheet }: { sheet: ResultSheetData }) {
  const s = sheet.student;
  return (
    <div className="result-sheet mx-auto max-w-[820px] bg-white p-10 text-[13px] leading-relaxed text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <style>{`
        @page { size: A4 portrait; margin: 16mm; }
        @media print {
          .result-sheet { color: #0f172a !important; }
          .no-print { display: none !important; }
        }
        .result-sheet table { width: 100%; border-collapse: collapse; }
        .result-sheet th, .result-sheet td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
        .result-sheet th { background: #f8fafc; font-weight: 600; }
      `}</style>

      <header className="mb-6 flex items-start justify-between border-b-2 border-slate-900 pb-4">
        <div>
          <p className="text-lg font-bold tracking-tight">EasyWay German Language School</p>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Student result sheet</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>Generated {fmtDate(sheet.generatedAt)}</p>
          {sheet.audience === "admin" ? (
            <p className="font-semibold text-amber-700">Office copy</p>
          ) : null}
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-x-8 gap-y-1">
        <p><span className="text-slate-500">Name:</span> <span className="font-semibold">{s.name}</span></p>
        <p><span className="text-slate-500">Student ID:</span> <span className="font-mono">{s.studentCode ?? "—"}</span></p>
        <p><span className="text-slate-500">Level:</span> <span className="font-semibold">{s.level}</span></p>
        <p><span className="text-slate-500">Branch:</span> {s.branch ?? "—"}</p>
        <p><span className="text-slate-500">Batch:</span> {s.batch ?? "—"}</p>
        <p><span className="text-slate-500">Sitting:</span> <span className="capitalize">{s.sessionSlot}</span></p>
        <p><span className="text-slate-500">Class type:</span> <span className="capitalize">{s.classType}</span></p>
        <p><span className="text-slate-500">First class:</span> {fmtDate(s.classesStartedAt)}</p>
      </section>

      <section className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Coursework average</p>
          <p className="mt-1 text-2xl font-bold">
            {sheet.overall === null ? "—" : `${sheet.overall}`}
            {sheet.overallGrade ? <span className="ml-1 text-base font-semibold text-slate-500">{sheet.overallGrade}</span> : null}
          </p>
          <p className="text-xs text-slate-500">
            Pass mark {sheet.passMark}
            {sheet.passing === null ? "" : sheet.passing ? " · passing" : " · below pass mark"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Attendance</p>
          <p className="mt-1 text-2xl font-bold">
            {sheet.attendance ? `${sheet.attendance.percent}%` : "—"}
          </p>
          <p className="text-xs text-slate-500">
            {sheet.attendance ? `${sheet.attendance.present} of ${sheet.attendance.held} classes` : "no register yet"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Class standing</p>
          <p className="mt-1 text-2xl font-bold capitalize">
            {sheet.standing ? sheet.standing.band : "—"}
          </p>
          <p className="text-xs text-slate-500">
            {sheet.standing ? `class of ${sheet.standing.classSize} · avg ${sheet.standing.classAverage}` : "not enough graded classmates"}
          </p>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Coursework skills</h2>
        {sheet.skills.length === 0 ? (
          <p className="text-slate-500">No coursework marks recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Skill</th><th>Average</th><th>Grade</th><th>Latest</th><th>Attempts</th><th>Trend</th><th>Result</th>
              </tr>
            </thead>
            <tbody>
              {sheet.skills.map((skill) => (
                <tr key={skill.type}>
                  <td>{labelFor(skill.type)}</td>
                  <td>{skill.average}</td>
                  <td>{skill.grade}</td>
                  <td>{skill.latest}</td>
                  <td>{skill.attempts}</td>
                  <td>{skill.change === null ? "—" : skill.change > 0 ? `+${skill.change}` : skill.change}</td>
                  <td>{skill.passed ? "Pass" : "Below"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sheet.marksOwed > 0 ? (
          <p className="mt-2 text-xs text-amber-700">
            {sheet.marksOwed} required skill{sheet.marksOwed === 1 ? "" : "s"} not yet marked — this sheet is incomplete.
          </p>
        ) : null}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
          Exam sittings <span className="font-normal text-slate-500">({sheet.examsPassed}/{sheet.examsTaken} passed)</span>
        </h2>
        {sheet.exams.length === 0 ? (
          <p className="text-slate-500">No exam sittings recorded{sheet.audience === "student" ? " and released" : ""} yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Sitting</th><th>Date</th><th>Score</th><th>L</th><th>H</th><th>S</th><th>W</th><th>Result</th>
              </tr>
            </thead>
            <tbody>
              {sheet.exams.map((exam) => (
                <tr key={exam.id}>
                  <td>
                    {exam.examName}
                    {exam.internalOnly ? <span className="ml-1 text-[10px] font-semibold text-amber-700">(not released)</span> : null}
                  </td>
                  <td>{exam.examDate.slice(0, 10)}</td>
                  <td>{exam.score}/{exam.total}</td>
                  <td>{exam.reading ?? "—"}</td>
                  <td>{exam.listening ?? "—"}</td>
                  <td>{exam.speaking ?? "—"}</td>
                  <td>{exam.writing ?? "—"}</td>
                  <td>{exam.passed ? `Pass (${exam.grade})` : `Fail (${exam.grade})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-[10px] text-slate-400">L Lesen · H Hören · S Sprechen · W Schreiben</p>
      </section>

      {sheet.office ? (
        <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-amber-800">Office notes — not shown to the student</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
            <p><span className="text-slate-500">Level signed off:</span> {sheet.office.levelCompletedFor ?? "no"}</p>
            <p>
              <span className="text-slate-500">Held back:</span>{" "}
              {sheet.office.heldBackAt ? `yes — ${sheet.office.heldBackReason ?? "no reason given"}` : "no"}
            </p>
            {sheet.office.finance ? (
              <>
                <p><span className="text-slate-500">Fees:</span> {sheet.office.finance.paymentStatus} · paid ₦{sheet.office.finance.totalPaid.toLocaleString()} of ₦{sheet.office.finance.tuitionFee.toLocaleString()}</p>
                <p><span className="text-slate-500">Outstanding:</span> ₦{sheet.office.finance.outstanding.toLocaleString()}</p>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="mt-8 border-t border-slate-200 pt-3 text-[10px] text-slate-400">
        This sheet reflects marks recorded at {fmtDate(sheet.generatedAt)}. Coursework average is weighted by
        assessment type and excludes formal exam sittings, which are reported separately above.
      </footer>
    </div>
  );
}
