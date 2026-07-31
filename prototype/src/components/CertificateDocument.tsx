"use client";

import type { CertificateView } from "@/lib/certificates";

/**
 * The printed certificate.
 *
 * Design notes worth not re-litigating:
 *
 * - Everything is sized in `cqw` against a container with `aspect-ratio:
 *   297/210` (A4 landscape). One set of numbers then holds at any width — the
 *   thumbnail, the full-screen view and the printed sheet are the same document
 *   scaled, not three layouts that drift apart.
 * - Styling is a scoped <style> block, not Tailwind. A certificate must look
 *   identical in dark mode, in print, and on a machine that never loaded the
 *   app's theme variables. Wiring it to `var(--surface)` would mean a navy
 *   certificate turning white the day someone edits globals.css.
 * - `print-color-adjust: exact` is required or browsers drop the navy ground and
 *   the gold, and print a white page with black text.
 * - The PROVISIONAL stamp is driven by the LIVE balance (see
 *   `src/lib/certificates.ts`), so clearing tuition removes it. That is the
 *   consequence the pay-in-full offer promises, made visible on the document.
 *
 * The ornament is doing a job. A certificate is read as evidence of worth
 * before a word of it is parsed, so the engine-turned ground, the double gold
 * rule, the corner fleurons and the wax seal are the argument: this is a
 * document you would frame, from a school that took your two months seriously.
 */

const MARK_SRC = "/logo-mark.png";

export default function CertificateDocument({
  certificate,
  verifyBaseUrl = "",
}: {
  certificate: CertificateView;
  /** Absolute origin for the printed verification URL, e.g. https://portal.easyway.ng */
  verifyBaseUrl?: string;
}) {
  const cert = certificate;
  const issued = new Date(cert.issuedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const verifyUrl = `${verifyBaseUrl}/verify/${cert.verifyCode}`;

  return (
    <div className="ewcert">
      <style>{CERT_CSS}</style>

      <div className="ewcert__sheet">
        <EngravedGround />

        {/* Double rule plus corner fleurons — the frame that reads as "document". */}
        <div className="ewcert__rule ewcert__rule--outer" />
        <div className="ewcert__rule ewcert__rule--inner" />
        <Fleuron position="tl" />
        <Fleuron position="tr" />
        <Fleuron position="bl" />
        <Fleuron position="br" />

        {cert.provisional ? <ProvisionalStamp outstanding={cert.outstanding} /> : null}
        {cert.revoked ? <div className="ewcert__revoked">REVOKED</div> : null}

        <div className="ewcert__body">
          <header className="ewcert__head">
            <div className="ewcert__crest">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MARK_SRC} alt="" className="ewcert__mark" />
            </div>
            <p className="ewcert__school">Easyway German Language School</p>
            <p className="ewcert__sub">
              {cert.branchName ? `${cert.branchName} Branch` : "Nigeria"} &middot; Goethe &amp; ÖSD Examination
              Preparation
            </p>
          </header>

          <p className="ewcert__title">{cert.title}</p>
          <div className="ewcert__titlerule">
            <span />
            <b>❖</b>
            <span />
          </div>

          <p className="ewcert__preamble">This is to certify that</p>
          <p className="ewcert__name">{cert.studentName}</p>
          <div className="ewcert__namerule" />

          <p className="ewcert__citation">{cert.citation}</p>

          <div className="ewcert__meta">
            <Field label="Level" value={cert.level} />
            <Field label="Award" value={cert.awardLabel} />
            {cert.averageScore !== null ? <Field label="Overall" value={`${cert.averageScore}%`} /> : null}
            {cert.studentCode ? <Field label="Student ID" value={cert.studentCode} /> : null}
          </div>

          {/* The seal sits between the citation and the signatures rather than
              inside the signature row. In the row it was taller than the two
              name columns, so its award band dropped below their baseline and
              collided with them; here it also fills what was otherwise a dead
              band across the middle of the sheet. */}
          <div className="ewcert__sealblock">
            <Seal award={cert.awardLabel} level={cert.level} />
          </div>

          <footer className="ewcert__foot">
            <Signature name={cert.tutorName ?? "&nbsp;"} role="Course Tutor" />
            <Signature name="&nbsp;" role="Director of Studies" />
          </footer>

          <div className="ewcert__ledger">
            <span>{cert.serial}</span>
            <span>Issued {issued}</span>
            <span>
              Verify: {verifyUrl.replace(/^https?:\/\//, "")} &nbsp;·&nbsp; Code {cert.verifyCode}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="ewcert__field">
      <span className="ewcert__fieldlabel">{label}</span>
      <span className="ewcert__fieldvalue">{value}</span>
    </div>
  );
}

function Signature({ name, role }: { name: string; role: string }) {
  return (
    <div className="ewcert__sig">
      <span className="ewcert__signame" dangerouslySetInnerHTML={{ __html: name }} />
      <span className="ewcert__sigrule" />
      <span className="ewcert__sigrole">{role}</span>
    </div>
  );
}

/**
 * The engine-turned ground: fine concentric arcs, the same trick banknotes and
 * share certificates use. Cheap in SVG, and impossible to reproduce in a Word
 * document, which is the point for something people photograph and forward.
 */
function EngravedGround() {
  return (
    <svg className="ewcert__ground" viewBox="0 0 1188 840" preserveAspectRatio="none" aria-hidden>
      <defs>
        <radialGradient id="ewcert-glow" cx="50%" cy="0%" r="90%">
          <stop offset="0%" stopColor="#1b3468" />
          <stop offset="60%" stopColor="#0d1c3c" />
          <stop offset="100%" stopColor="#070f22" />
        </radialGradient>
        <pattern id="ewcert-guilloche" width="76" height="76" patternUnits="userSpaceOnUse">
          {[11, 21, 31, 41].map((r) => (
            <circle key={r} cx="38" cy="38" r={r} fill="none" stroke="#c8a24a" strokeWidth="0.4" opacity="0.13" />
          ))}
        </pattern>
      </defs>
      <rect width="1188" height="840" fill="url(#ewcert-glow)" />
      <rect width="1188" height="840" fill="url(#ewcert-guilloche)" />
    </svg>
  );
}

function Fleuron({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  return (
    <svg className={`ewcert__fleuron ewcert__fleuron--${position}`} viewBox="0 0 100 100" aria-hidden>
      <g fill="none" stroke="#c8a24a" strokeWidth="1.6" opacity="0.9">
        <path d="M4 30 C4 14 14 4 30 4" />
        <path d="M10 34 C10 20 20 10 34 10" opacity="0.6" />
        <path d="M12 12 C28 12 34 20 34 34 C22 34 12 26 12 12 Z" fill="#c8a24a" fillOpacity="0.18" />
        <circle cx="23" cy="23" r="2.6" fill="#c8a24a" stroke="none" />
      </g>
    </svg>
  );
}

/** The wax-and-gold seal. Ring text is set on a path so it curves properly. */
function Seal({ award, level }: { award: string; level: string }) {
  return (
    <div className="ewcert__sealwrap">
      <svg viewBox="0 0 200 200" className="ewcert__seal" aria-hidden>
        <defs>
          <linearGradient id="ewcert-gold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f4e2a6" />
            <stop offset="35%" stopColor="#c8a24a" />
            <stop offset="65%" stopColor="#9c7a2c" />
            <stop offset="100%" stopColor="#e6cd8b" />
          </linearGradient>
          <path id="ewcert-sealpath" d="M100,100 m-72,0 a72,72 0 1,1 144,0 a72,72 0 1,1 -144,0" />
        </defs>

        {/* Scalloped rosette edge */}
        <g fill="url(#ewcert-gold)">
          {Array.from({ length: 32 }).map((_, i) => {
            const angle = (i / 32) * Math.PI * 2;
            return <circle key={i} cx={100 + Math.cos(angle) * 88} cy={100 + Math.sin(angle) * 88} r="9" />;
          })}
        </g>
        <circle cx="100" cy="100" r="88" fill="url(#ewcert-gold)" />
        <circle cx="100" cy="100" r="78" fill="#0b1830" />
        <circle cx="100" cy="100" r="74" fill="none" stroke="url(#ewcert-gold)" strokeWidth="1.5" />

        <text className="ewcert__sealring" fill="#e6cd8b">
          <textPath href="#ewcert-sealpath" startOffset="50%" textAnchor="middle">
            · EASYWAY GERMAN LANGUAGE SCHOOL ·
          </textPath>
        </text>

        <text x="100" y="94" className="ewcert__sealmono" fill="url(#ewcert-gold)">
          EW
        </text>
        <text x="100" y="126" className="ewcert__seallevel" fill="#e6cd8b">
          {level}
        </text>
      </svg>
      <span className="ewcert__sealband">{award}</span>
    </div>
  );
}

function ProvisionalStamp({ outstanding }: { outstanding: number }) {
  return (
    <>
      <div className="ewcert__provisional" aria-hidden>
        PROVISIONAL
      </div>
      <div className="ewcert__provisionalnote">
        Provisional pending settlement of ₦{Math.round(outstanding).toLocaleString()} outstanding tuition. Clear the
        balance to be issued the final certificate.
      </div>
    </>
  );
}

/**
 * All measurements are in cqw (1cqw = 1% of the sheet's width), so the document
 * is resolution-independent: the same numbers hold for a 240px thumbnail and an
 * A4 print.
 */
const CERT_CSS = `
.ewcert { container-type: inline-size; width: 100%; }
.ewcert__sheet {
  position: relative;
  aspect-ratio: 297 / 210;
  width: 100%;
  overflow: hidden;
  background: #0b1830;
  color: #f3ede0;
  font-family: Georgia, "Times New Roman", Cambria, serif;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.ewcert__ground { position: absolute; inset: 0; width: 100%; height: 100%; }

.ewcert__rule { position: absolute; pointer-events: none; }
.ewcert__rule--outer {
  inset: 2.2cqw;
  border: 0.42cqw solid transparent;
  border-image: linear-gradient(135deg, #f4e2a6, #c8a24a 35%, #8c6c22 65%, #e6cd8b) 1;
}
.ewcert__rule--inner { inset: 3.4cqw; border: 0.12cqw solid rgba(200,162,74,0.55); }

.ewcert__fleuron { position: absolute; width: 7cqw; height: 7cqw; }
.ewcert__fleuron--tl { top: 3.1cqw; left: 3.1cqw; }
.ewcert__fleuron--tr { top: 3.1cqw; right: 3.1cqw; transform: scaleX(-1); }
.ewcert__fleuron--bl { bottom: 3.1cqw; left: 3.1cqw; transform: scaleY(-1); }
.ewcert__fleuron--br { bottom: 3.1cqw; right: 3.1cqw; transform: scale(-1,-1); }

.ewcert__body {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center;
  padding: 5cqw 8cqw 3.2cqw;
  text-align: center;
}

.ewcert__head { display: flex; flex-direction: column; align-items: center; }
.ewcert__crest {
  width: 6.6cqw; height: 6.6cqw; border-radius: 50%;
  display: grid; place-items: center;
  background: radial-gradient(circle at 30% 25%, #1d3a72, #0a1730);
  box-shadow: 0 0 0 0.16cqw #c8a24a, 0 0 0 0.34cqw rgba(200,162,74,0.28);
}
.ewcert__mark { width: 78%; height: 78%; object-fit: contain; }
.ewcert__school {
  margin: 1.1cqw 0 0; font-size: 1.62cqw; letter-spacing: 0.34cqw;
  text-transform: uppercase; color: #e6cd8b; font-weight: 700;
}
.ewcert__sub { margin: 0.4cqw 0 0; font-size: 1cqw; letter-spacing: 0.11cqw; color: rgba(243,237,224,0.6); }

.ewcert__title {
  margin: 1.9cqw 0 0; font-size: 4.1cqw; line-height: 1; letter-spacing: 0.42cqw;
  text-transform: uppercase; font-weight: 700;
  background: linear-gradient(180deg, #fdf7de 0%, #f2debf 26%, #d9b463 58%, #b08c34 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.ewcert__titlerule { display: flex; align-items: center; gap: 0.8cqw; margin-top: 1cqw; width: 40cqw; }
.ewcert__titlerule span { flex: 1; height: 0.09cqw; background: linear-gradient(90deg, transparent, #c8a24a, transparent); }
.ewcert__titlerule b { color: #c8a24a; font-size: 1.1cqw; }

.ewcert__preamble { margin: 1.6cqw 0 0; font-size: 1.28cqw; font-style: italic; color: rgba(243,237,224,0.72); }
.ewcert__name {
  margin: 0.7cqw 0 0; font-size: 5cqw; line-height: 1.05; font-style: italic; font-weight: 700;
  color: #f7ecc4; text-shadow: 0 0.12cqw 0.5cqw rgba(0,0,0,0.45);
}
.ewcert__namerule {
  margin-top: 0.7cqw; width: 52cqw; height: 0.1cqw;
  background: linear-gradient(90deg, transparent, rgba(200,162,74,0.9), transparent);
}
.ewcert__citation {
  margin: 1.5cqw 0 0; max-width: 62cqw; font-size: 1.42cqw; line-height: 1.6;
  color: rgba(243,237,224,0.9);
}

.ewcert__meta { display: flex; gap: 3.6cqw; margin-top: 2.1cqw; }
.ewcert__field { display: flex; flex-direction: column; gap: 0.24cqw; }
.ewcert__fieldlabel {
  font-size: 0.78cqw; letter-spacing: 0.22cqw; text-transform: uppercase; color: rgba(200,162,74,0.85);
}
.ewcert__fieldvalue { font-size: 1.42cqw; font-weight: 700; color: #f3ede0; }

/* Auto margins top AND bottom centre the seal in whatever space the citation
   leaves, so a short citation and a long one both look composed. */
.ewcert__sealblock { margin: auto 0; }
.ewcert__foot {
  width: 100%;
  display: grid; grid-template-columns: 1fr 1fr; align-items: end; gap: 4cqw;
}
.ewcert__sig { display: flex; flex-direction: column; align-items: center; gap: 0.3cqw; }
.ewcert__signame { font-size: 1.5cqw; font-style: italic; color: #f3ede0; min-height: 1.8cqw; }
.ewcert__sigrule { width: 20cqw; height: 0.09cqw; background: rgba(200,162,74,0.7); }
.ewcert__sigrole {
  font-size: 0.78cqw; letter-spacing: 0.2cqw; text-transform: uppercase; color: rgba(243,237,224,0.62);
}

.ewcert__sealwrap { display: flex; flex-direction: column; align-items: center; gap: 0.5cqw; }
.ewcert__seal { width: 12.6cqw; height: 12.6cqw; filter: drop-shadow(0 0.3cqw 0.7cqw rgba(0,0,0,0.5)); }
.ewcert__sealring { font-size: 13px; letter-spacing: 2.6px; font-family: Georgia, serif; }
.ewcert__sealmono { font-size: 46px; font-weight: 700; text-anchor: middle; font-family: Georgia, serif; }
.ewcert__seallevel { font-size: 20px; letter-spacing: 4px; text-anchor: middle; font-family: Georgia, serif; }
.ewcert__sealband {
  font-size: 0.86cqw; letter-spacing: 0.24cqw; text-transform: uppercase; font-weight: 700;
  color: #1a1206; background: linear-gradient(135deg, #f4e2a6, #c8a24a);
  padding: 0.24cqw 1.1cqw; border-radius: 0.3cqw;
}

.ewcert__ledger {
  display: flex; justify-content: space-between; gap: 2cqw;
  width: 100%; margin-top: 1.4cqw;
  font-size: 0.86cqw; letter-spacing: 0.06cqw; color: rgba(243,237,224,0.55);
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.ewcert__provisional {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-19deg);
  font-size: 8.8cqw; font-weight: 700; letter-spacing: 0.9cqw; white-space: nowrap;
  color: transparent; -webkit-text-stroke: 0.22cqw rgba(255,120,120,0.5);
  opacity: 0.75; pointer-events: none;
}
.ewcert__provisionalnote {
  position: absolute; left: 0; right: 0; bottom: 0.7cqw;
  font-size: 0.9cqw; color: rgba(255,170,170,0.95); text-align: center;
}
.ewcert__revoked {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-19deg);
  font-size: 12cqw; font-weight: 700; letter-spacing: 1.4cqw; color: rgba(255,90,90,0.35);
}

@media print {
  @page { size: A4 landscape; margin: 0; }
  .ewcert { width: 100%; }
  .ewcert__sheet { box-shadow: none; }
}
`;
