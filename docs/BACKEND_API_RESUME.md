# [YOUR NAME]

**Backend / API Developer**  
[City, Country] | Remote  | [Email] | [Phone]  
[GitHub URL] | [Portfolio URL] | [LinkedIn URL]

## Summary

Backend-focused engineer building and operating a production-oriented learning platform with TypeScript, Node.js, Next.js, Prisma, and PostgreSQL. Experienced in designing authenticated REST APIs, relational data models, payment and video-service integrations, AI-assisted content workflows, multi-tenant access controls, background jobs, and operational tooling. Comfortable taking a feature from schema design through API implementation, verification, and deployment documentation.

## Technical Skills

**Backend:** Node.js, TypeScript, Next.js Route Handlers, REST APIs, Prisma ORM, PostgreSQL, SQLite  
**Security:** NextAuth, bcrypt password hashing, TOTP MFA, scoped API keys, tenant isolation, audit logs, soft deletion  
**Integrations:** Paystack, Stripe, LiveKit, Anthropic API, Ollama, S3-compatible storage, SMTP/Nodemailer, Web Push  
**Content and media:** PDF/DOCX extraction, `sharp`, FFmpeg, uploads, recordings, thumbnails  
**Testing and delivery:** Vitest, TypeScript type checking, ESLint, Vercel, Neon PostgreSQL, GitHub Actions, Prisma migrations  
**Additional:** [Docker experience], [cloud provider experience], [Go/Python experience if applicable]

## Selected Project

### Easyway LMS | Backend and Platform Engineering
**TypeScript, Node.js, Next.js, Prisma, PostgreSQL, Vercel, Neon**

- Designed a relational LMS domain spanning tenants, branches, users, students, lecturers, pathways, courses, modules, lessons, materials, enrollments, assignments, exams, attendance, payments, notifications, community, and learning progress.
- Built authenticated REST API routes for student onboarding, course administration, lesson generation, mission progress, attendance, scheduling, assignments, grading, reports, notifications, community discussions, uploads, and admin operations.
- Implemented an AI-assisted lesson workflow that accepts pasted or uploaded TXT, PDF, and DOCX content, extracts text, sends structured prompts to AI providers, and persists generated courses, modules, and lessons through API endpoints.
- Integrated Paystack and Stripe payment flows, including checkout/initialization, verification, webhook handling, payment persistence, invoice state, deposit versus full-payment classification, and access or enrollment decisions.
- Implemented LiveKit session APIs with authentication, payment and access checks, room permissions, token minting, and recording startup support.
- Built a partner-facing versioned API surface with bearer API keys, scopes, tenant context, cursor pagination, usage metering, and endpoints for students, payments, classes, attendance, and usage.
- Added platform safeguards including encrypted TOTP secrets, hashed recovery codes, replay-resistant TOTP checks, admin capability controls, audit logs, soft-delete restoration, and tenant-scoped access.
- Documented and prepared deployment on Vercel with Neon PostgreSQL, pooled and direct database URLs, S3-compatible object storage, scheduled cron processing, and extended function timeouts for long-running AI, import, cron, and recording routes.
- Added Vitest coverage and proof scripts for API-key behavior, tenant isolation, scope enforcement, pagination, billing, admin scope, community workflows, retention, backups, and live-service configuration.

## Experience

### [Role or Independent Engineering] | [Company / Client]
**[Location or Remote] | [Month Year] - Present**

- [Add your real employment or freelance scope here.]
- [Add measurable outcomes: users served, API latency, payment volume, uptime, or delivery time.]
- [Add any Docker, cloud infrastructure, Python, Go, or PostgreSQL production work not represented in this repository.]

## Education

**[Degree, diploma, or relevant training]** | [Institution] | [Year]

## Availability

Available for full-time remote contract work: [availability].  
Monthly rate expectation: **$[AMOUNT] USD**.

## Notes Before Sending

- Replace every bracketed placeholder.
- Add only your actual years of experience and public links.
- Do not claim Docker, Go, Python, or production email delivery unless you can walk through the implementation.
- Keep the resume to one page after adding your personal experience.