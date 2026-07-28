EasyWay LMS — Upgrade Roadmap

Goal: Turn the current learning prototype into a full EasyWay operational LMS covering Student, Tutor, Admin, Exams/Payments, Community, Notifications, and Financial reporting.

Phases

Phase 1 — Core LMS Operations (2–3 weeks)
- Admin dashboard skeleton with sidebar and branch filter
- Student CRUD (add/edit/move/graduate/readmit)
- Tutor assignment by branch/session/level
- Materials listing and download (read-only)
Deliverables: `Admin dashboard` pages, APIs for student CRUD, branch model and sample data
Acceptance: Admin can filter students by branch/session/level and perform lifecycle actions.

Phase 2 — Exams & Attendance (2–3 weeks)
- Exam model, admin exam creation, slot management, calendar view
- Exam registration form (student & external), Paystack integration for fees
- Tutor/admin result entry and certificate generation
- Attendance recording by tutor and student-facing attendance view
Deliverables: Exam registration flow, payment webhook handling, attendance API
Acceptance: Students can register/pay for exams and registrations decrement slots automatically.

Phase 3 — Community & Communication (1–2 weeks)
- Community channels (general + branch + level) with posting and replies
- Notification center and email templates (welcome, reminders, graduation)
- Bulk email tool (send to branch/level/all)
Deliverables: Community pages, notification enqueue system, email templates
Acceptance: Users see branch-limited channels; admins can broadcast messages.

Phase 4 — Finance & Reporting (1–2 weeks)
- Financial overview (revenue, outstanding balances, revenue by branch)
- Monthly charts for enrollment & revenue
- Exam financial reports and export CSV
Deliverables: Reporting APIs and dashboard widgets
Acceptance: Admins can view revenue by branch and export reports.

Phase 5 — Polish, Tests & Deploy (1 week)
- End-to-end tests for core flows, CI, GitHub push, documentation, and deploy instructions
- Add environment checks for Ollama, Stripe, Paystack
Deliverables: Tests, CI config, README updates, release notes
Acceptance: CI runs tests and builds; README contains deploy steps.

Immediate next steps (task 1 continuing)
- Create/update Prisma models: `Branch`, `Exam`, `Attendance`, `CommunityChannel`, `Notification`
- Add admin routes and placeholder pages under `prototype/src/app/admin`
- Create open PR with roadmap and todos

If you’re ready I’ll begin by adding the roadmap file (done) and scaffolding Prisma models and the `admin` pages in `prototype/` next. Reply "Go" to continue with scaffolding or tell me which task to prioritize.