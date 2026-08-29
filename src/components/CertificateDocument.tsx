"use client";

import type { CertificateView } from "@/lib/certificates";
import {
  DEFAULT_CERTIFICATE_TEMPLATE,
  fillTokens,
  type CertificateTemplate,
} from "@/lib/certificate-template";

/**
 * The printed certificate.
 *
 * Rebuilt from the school's own artwork: the German flag bar down the left
 * edge, the red Teilnahmebestätigung, the name in script over a dotted rule,
 * two signatories either side of a gold Excellence seal. What the artwork does
 * not have and this does is a frame, an engraved ground and a verification
 * block — a certificate is read as evidence of worth before a word of it is
 * parsed, and a bare sheet of white with centred text reads as a printout.
 *
 * Design notes worth not re-litigating:
 *
 * - Everything is sized in `cqw` against a container with `aspect-ratio:
 *   297/210` (A4 landscape). One set of numbers then holds at any width — the
 *   thumbnail, the full-screen view and the printed sheet are the same document
 *   scaled, not three layouts that drift apart.
 * - Styling is a scoped <style> block, not Tailwind. A certificate must look
 *   identical in dark mode, in print, and on a machine that never loaded the
 *   app's theme variables. Wiring it to `var(--surface)` would mean a document
 *   turning white the day someone edits globals.css.
 * - Colours come from the TEMPLATE, not from the theme, for the same reason.
 *   The red is the school's printed red; it must not follow the portal accent.
 * - `print-color-adjust: exact` is required or browsers drop the flag bar, the
 *   red heading and the gold, and print a white page with black text.
 * - The PROVISIONAL stamp is driven by the LIVE balance (see
 *   `src/lib/certificates.ts`), so clearing tuition removes it. That is the
 *   consequence the pay-in-full offer promises, made visible on the document.
 *
 * Every string other than the student's own facts comes from the template and
 * is editable at /admin/certificates. The previous version hardcoded the
 * address and both signatory titles, so a change of Head of Department was a
 * code change and a deploy.
 */

const MARK_SRC = "/logo-mark.png";

export default function CertificateDocument({
  certificate,
  verifyBaseUrl = "",
  template = DEFAULT_CERTIFICATE_TEMPLATE,
}: {
  certificate: CertificateView;
  /** Absolute origin for the printed verification URL, e.g. https://portal.easyway.ng */
  verifyBaseUrl?: string;
  /** School-editable wording, signatories and colours. */
  template?: CertificateTemplate;
}) {
  const cert = certificate;

  const longDate = (value: string) =>
    new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const dayMonth = (value: string) =>
    new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  const issued = longDate(cert.issuedAt);
  const verifyUrl = `${verifyBaseUrl}/verify/${cert.verifyCode}`;

  /**
   * The dates the course actually ran. An employer or a consulate reading this
   * needs to know WHEN the study happened, not only when the paper was printed
   * — "issued 12 August" says nothing about whether that was eight weeks of
   * study or one. The from/to rule renders empty rather than guessing on
   * certificates issued before these were recorded, which keeps the layout
   * identical either way.
   */
  const from = cert.courseStart ? dayMonth(cert.courseStart) : "";
  const to = cert.courseEnd ? dayMonth(cert.courseEnd) : "";
  const year = cert.courseEnd
    ? new Date(cert.courseEnd).getFullYear().toString()
    : new Date(cert.issuedAt).getFullYear().toString();

  const tokens = {
    name: cert.studentName,
    level: cert.level,
    branch: cert.branchName ?? "",
    tutor: cert.tutorName ?? "",
    from,
    to,
    year,
    serial: cert.serial,
    school: template.schoolName,
  };
  const fill = (line: string) => fillTokens(line, tokens);

  const hasLeft = Boolean(template.leftSignatoryName || template.leftSignatoryRole);
  const hasRight = Boolean(template.rightSignatoryName || template.rightSignatoryRole);

  return (
    <div className="ewcert">
      <style>{CERT_CSS}</style>

      <div
        className="ewcert__sheet"
        style={
          {
            "--cert-accent": template.accentColor,
            "--cert-ink": template.inkColor,
          } as React.CSSProperties
        }
      >
        {template.showGuilloche && <EngravedGround />}

        {/* The German flag, full height down the binding edge. Straight off the
            school's artwork, and the single strongest signal of what the
            document is before anybody reads a word of it. */}
        {template.showFlagBar && (
          <div className="ewcert__flag" aria-hidden="true">
            <span className="ewcert__flag-band ewcert__flag-band--black" />
            <span className="ewcert__flag-band ewcert__flag-band--red" />
            <span className="ewcert__flag-band ewcert__flag-band--gold" />
          </div>
        )}

        {/* Double rule and corner fleurons — the frame that reads as "document"
            rather than "page from a printer". */}
        <div className="ewcert__frame">
          <Fleuron position="tl" />
          <Fleuron position="tr" />
          <Fleuron position="bl" />
          <Fleuron position="br" />
        </div>

        <div className="ewcert__body">
          {/* ---- Masthead ---- */}
          <header className="ewcert__masthead">
            {/* eslint-disable-next-line @next/next/no-img-element -- the print
                path and the html2canvas export both need a plain <img>; the
                Next image loader emits a srcset neither follows. */}
            <img src={MARK_SRC} alt="" className="ewcert__mark" />
            <h1 className="ewcert__school">{template.schoolName}</h1>
            <p className="ewcert__address">{template.addressLine}</p>
            {template.registrationLine && (
              <p className="ewcert__registration">{template.registrationLine}</p>
            )}
          </header>

          {/* ---- Titles ---- */}
          <div className="ewcert__titles">
            <div className="ewcert__rule-flourish">
              <span className="ewcert__rule" />
              <span className="ewcert__diamond" />
              <span className="ewcert__rule" />
            </div>
            <h2 className="ewcert__title-de">{template.germanTitle}</h2>
            <p className="ewcert__title-en">{template.englishTitle}</p>
          </div>

          {/* ---- Citation ---- */}
          <div className="ewcert__citation">
            <p className="ewcert__lead">{fill(template.certifyLine)}</p>

            <p className="ewcert__name">{cert.studentName}</p>
            <span className="ewcert__name-rule" />

            <p className="ewcert__lead">{fill(template.courseLine)}</p>
            <p className="ewcert__course">{fill(template.completionLine)}</p>

            {from && to && (
              <p className="ewcert__dates">
                <span className="ewcert__dates-label">from</span>
                <span className="ewcert__dates-value">{from}</span>
                <span className="ewcert__dates-label">to</span>
                <span className="ewcert__dates-value">{to}</span>
                <span className="ewcert__dates-year">{year}</span>
              </p>
            )}

            <p className="ewcert__closing">{fill(template.closingLine)}</p>
          </div>

          {/*
            THE SLACK LIVES HERE, IN A REAL ELEMENT.

            It was `margin-top: auto` on the foot, then `margin-bottom: auto` on
            the citation. Both are the same trap: an auto margin inside a
            `height: 100%` box whose height comes from `aspect-ratio` resolves
            against a box the browser has not finished sizing, so it swallowed
            every reduction made above it — trimming 48px of type moved the foot
            by 4px — and pinned the footer to the bottom edge with the
            verification line pushed out through `overflow: hidden`. A printed
            certificate was losing its serial and verify URL.

            A flex child with `flex: 1 1 0` takes exactly the space left over
            and, unlike an auto margin, shrinks to nothing rather than
            displacing its siblings when there is none.
          */}
          <span className="ewcert__spacer" aria-hidden="true" />

          {/* ---- Signatories and seal ---- */}
          <footer className="ewcert__foot">
            <Signature
              name={template.leftSignatoryName}
              role={template.leftSignatoryRole}
              imageUrl={template.leftSignatureUrl}
              show={hasLeft}
            />

            {template.showSeal ? (
              <Seal
                top={template.sealTopText}
                bottom={template.sealBottomText}
                level={cert.level}
              />
            ) : (
              <span className="ewcert__seal-spacer" />
            )}

            <Signature
              name={template.rightSignatoryName}
              role={template.rightSignatoryRole}
              imageUrl={template.rightSignatureUrl}
              show={hasRight}
            />
          </footer>

          {/* ---- Verification ---- */}
          {template.showVerifyBlock && (
            <div className="ewcert__verify">
              <span>
                Serial <strong>{cert.serial}</strong>
              </span>
              <span className="ewcert__verify-sep">·</span>
              <span>Issued {issued}</span>
              <span className="ewcert__verify-sep">·</span>
              <span>
                Verify at <strong>{verifyUrl.replace(/^https?:\/\//, "")}</strong>
              </span>
            </div>
          )}

          {/* ---- Disclaimer ---- */}
          <p className="ewcert__disclaimer">
            This is electronically generated and it's valid anywhere.
          </p>
        </div>

        {cert.revoked && <RevokedStamp />}
        {!cert.revoked && cert.provisional && <ProvisionalStamp outstanding={cert.outstanding} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Signature({
  name,
  role,
  imageUrl,
  show,
}: {
  name: string;
  role: string;
  imageUrl: string;
  show: boolean;
}) {
  // An empty block still occupies its column. A school with one signatory
  // should get a centred seal, not a seal that slides left.
  if (!show) return <span className="ewcert__sign" aria-hidden="true" />;

  return (
    <div className="ewcert__sign">
      <div className="ewcert__sign-ink">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- see the masthead note
          <img src={imageUrl} alt="" className="ewcert__sign-image" />
        ) : (
          <span className="ewcert__sign-script">{name}</span>
        )}
      </div>
      <span className="ewcert__sign-rule" />
      {name && imageUrl && <p className="ewcert__sign-name">{name}</p>}
      <p className="ewcert__sign-role">{role}</p>
    </div>
  );
}

/**
 * The gold rosette. Drawn rather than an image so it stays sharp at print
 * resolution and recolours with the template instead of needing new artwork.
 */
function Seal({ top, bottom, level }: { top: string; bottom: string; level: string }) {
  return (
    <div className="ewcert__seal" aria-hidden="true">
      <svg viewBox="0 0 120 140" className="ewcert__seal-svg">
        <defs>
          <linearGradient id="ewGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F7E7A6" />
            <stop offset="35%" stopColor="#D4AF37" />
            <stop offset="55%" stopColor="#B8860B" />
            <stop offset="100%" stopColor="#8A6508" />
          </linearGradient>
          <linearGradient id="ewGoldRim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFF3C4" />
            <stop offset="50%" stopColor="#C9971C" />
            <stop offset="100%" stopColor="#7A5A06" />
          </linearGradient>
        </defs>

        {/* Ribbons, behind the disc */}
        <path d="M44 92 L36 136 L54 126 L60 138 L60 96 Z" fill="#B3151B" />
        <path d="M76 92 L84 136 L66 126 L60 138 L60 96 Z" fill="#8E0F14" />

        {/* Fluted outer edge */}
        <g>
          {Array.from({ length: 24 }).map((_, index) => {
            const angle = (index / 24) * Math.PI * 2;
            return (
              <circle
                key={index}
                cx={60 + Math.cos(angle) * 44}
                cy={58 + Math.sin(angle) * 44}
                r={6}
                fill="url(#ewGoldRim)"
              />
            );
          })}
        </g>

        <circle cx="60" cy="58" r="44" fill="url(#ewGold)" />
        <circle cx="60" cy="58" r="36" fill="none" stroke="#7A5A06" strokeWidth="1.5" />
        <circle cx="60" cy="58" r="27" fill="#1C1C1C" />

        <path
          d="M60 44 l3.6 7.6 8.4 1.1 -6.2 5.9 1.6 8.3 -7.4 -4 -7.4 4 1.6 -8.3 -6.2 -5.9 8.4 -1.1 Z"
          fill="#F5D77A"
        />

        {/* ON THE GOLD RING, NOT ON THE DISC. These sat at y=34 and y=88,
            which is inside the black inner circle (it spans y 31–85) — dark
            brown lettering on near-black, invisible at any size. They belong in
            the ring between r=27 and r=44. */}
        <text x="60" y="24" className="ewcert__seal-text" textAnchor="middle">
          {top}
        </text>
        <text x="60" y="99" className="ewcert__seal-text" textAnchor="middle">
          {bottom}
        </text>
        <text x="60" y="78" className="ewcert__seal-level" textAnchor="middle">
          {level}
        </text>
      </svg>
    </div>
  );
}

/** The engine-turned ground. Two rotated hairline grids, very low contrast. */
function EngravedGround() {
  return <div className="ewcert__ground" aria-hidden="true" />;
}

function Fleuron({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  return (
    <svg className={`ewcert__fleuron ewcert__fleuron--${position}`} viewBox="0 0 60 60" aria-hidden="true">
      <path
        d="M2 2 C 22 2, 34 8, 40 20 M2 2 C 2 22, 8 34, 20 40 M2 2 L 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="2.4" fill="currentColor" />
    </svg>
  );
}

function ProvisionalStamp({ outstanding }: { outstanding: number }) {
  return (
    <div className="ewcert__stamp" aria-hidden="true">
      <span className="ewcert__stamp-title">Provisional</span>
      <span className="ewcert__stamp-sub">
        ₦{Math.round(outstanding).toLocaleString("en-NG")} tuition outstanding
      </span>
    </div>
  );
}

function RevokedStamp() {
  return (
    <div className="ewcert__stamp ewcert__stamp--revoked" aria-hidden="true">
      <span className="ewcert__stamp-title">Revoked</span>
      <span className="ewcert__stamp-sub">This certificate is no longer valid</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const CERT_CSS = `
.ewcert { container-type: inline-size; width: 100%; }

/* SELF-CONTAINED MEANS SELF-CONTAINED.
   The sheet is height:100% with padding, so under content-box that padding is
   ADDED to the full height and the foot is pushed out through overflow:hidden
   — the printed certificate loses its serial and verify line. Tailwind's
   preflight happens to set this globally today, which is exactly why it was
   invisible: the document renders correctly inside the app and breaks anywhere
   else, including the print and export paths this component exists to serve.
   It declares its own box model. */
.ewcert, .ewcert *, .ewcert *::before, .ewcert *::after { box-sizing: border-box; }

.ewcert__sheet {
  position: relative;
  aspect-ratio: 297 / 210;
  width: 100%;
  overflow: hidden;
  background: #ffffff;
  color: var(--cert-ink, #111);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  box-shadow: 0 2cqw 6cqw rgba(15, 23, 42, 0.14);
}

/* ---- Ground ---- */
.ewcert__ground {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    repeating-linear-gradient(45deg, rgba(17,17,17,0.045) 0 0.12cqw, transparent 0.12cqw 1.05cqw),
    repeating-linear-gradient(-45deg, rgba(17,17,17,0.03) 0 0.1cqw, transparent 0.1cqw 1.6cqw);
}

/* ---- Flag bar ---- */
.ewcert__flag {
  position: absolute; left: 0; top: 0; bottom: 0; width: 3.6cqw;
  display: flex; flex-direction: column;
  box-shadow: inset -0.18cqw 0 0 rgba(0,0,0,0.18);
}
.ewcert__flag-band { flex: 1; }
.ewcert__flag-band--black { background: #0B0B0B; }
.ewcert__flag-band--red   { background: #DD0000; }
.ewcert__flag-band--gold  { background: #FFCE00; }

/* ---- Frame ---- */
.ewcert__frame {
  position: absolute; inset: 2.2cqw 2.2cqw 2.2cqw 6.4cqw;
  border: 0.28cqw solid var(--cert-accent, #D81E22);
  outline: 0.1cqw solid rgba(184, 134, 11, 0.85);
  outline-offset: 0.5cqw;
  color: rgba(184, 134, 11, 0.9);
  pointer-events: none;
}
.ewcert__fleuron { position: absolute; width: 4.4cqw; height: 4.4cqw; }
.ewcert__fleuron--tl { top: 0.5cqw; left: 0.5cqw; }
.ewcert__fleuron--tr { top: 0.5cqw; right: 0.5cqw; transform: scaleX(-1); }
.ewcert__fleuron--bl { bottom: 0.5cqw; left: 0.5cqw; transform: scaleY(-1); }
.ewcert__fleuron--br { bottom: 0.5cqw; right: 0.5cqw; transform: scale(-1, -1); }

/* ---- Layout ----
   THE SHEET IS A FIXED BOX AND IT CLIPS. aspect-ratio plus overflow:hidden
   means anything taller than A4 landscape is silently cut off, and the
   first casualty is the verification line at the very bottom — a printed
   certificate losing its serial and verify URL is the one failure this
   document cannot have. Every size below is therefore chosen to leave the foot
   inside the sheet at the tightest case (a long school name wrapping to two
   lines). Measured, not eyeballed. */
.ewcert__body {
  position: relative; height: 100%;
  padding: 3cqw 7cqw 2.2cqw 9cqw;
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
}

/* ---- Masthead ---- */
.ewcert__masthead { display: flex; flex-direction: column; align-items: center; }
.ewcert__mark { width: 7.4cqw; height: auto; object-fit: contain; }
.ewcert__school {
  margin: 0.75cqw 0 0; font-size: 3.3cqw; font-weight: 800;
  letter-spacing: 0.06em; text-transform: uppercase; line-height: 1.05;
}
.ewcert__address { margin: 0.5cqw 0 0; font-size: 1.3cqw; font-weight: 600; letter-spacing: 0.01em; }
.ewcert__registration { margin: 0.18cqw 0 0; font-size: 1.05cqw; color: #555; letter-spacing: 0.08em; }

/* ---- Titles ---- */
.ewcert__titles { margin-top: 1cqw; width: 100%; }
.ewcert__rule-flourish { display: flex; align-items: center; justify-content: center; gap: 0.9cqw; }
.ewcert__rule { display: block; height: 0.16cqw; width: 17cqw; background: linear-gradient(90deg, rgba(184,134,11,0) 0%, rgba(184,134,11,0.95) 55%, rgba(184,134,11,0.95) 100%); }
.ewcert__rule-flourish > .ewcert__rule:last-child { transform: scaleX(-1); }
.ewcert__diamond {
  display: block; width: 0.85cqw; height: 0.85cqw;
  background: var(--cert-accent, #D81E22); transform: rotate(45deg);
}
.ewcert__title-de {
  margin: 0.75cqw 0 0; font-size: 4cqw; font-weight: 800;
  letter-spacing: 0.13em; text-transform: uppercase; line-height: 1;
  color: var(--cert-accent, #D81E22);
}
.ewcert__title-en {
  margin: 0.5cqw 0 0; font-size: 1.85cqw; font-weight: 600;
  letter-spacing: 0.19em; text-transform: uppercase;
}

/* ---- Citation ---- */
.ewcert__citation { margin-top: 1.1cqw; width: 100%; }
/* Takes the leftover height. See the note in the markup for why this is an
   element and not an auto margin. */
.ewcert__spacer { display: block; flex: 1 1 0; min-height: 0; }
.ewcert__lead { margin: 0; font-size: 1.62cqw; }
.ewcert__name {
  margin: 0.5cqw 0 0;
  /* A script face, with a serif italic behind it. The stack is deliberately
     system-only: a certificate has to render identically on a machine that has
     never loaded a webfont, including the school's own printer driver. */
  font-family: "Brush Script MT", "Segoe Script", "Lucida Handwriting", "Apple Chancery", "URW Chancery L", cursive, serif;
  font-size: 5.6cqw; font-weight: 500; line-height: 1.12;
  letter-spacing: 0.005em;
}
.ewcert__name-rule {
  display: block; margin: 0.15cqw auto 0.9cqw; width: 62%; height: 0;
  border-bottom: 0.12cqw dotted rgba(17,17,17,0.5);
}
.ewcert__course { margin: 0.45cqw 0 0; font-size: 2.05cqw; font-weight: 700; }

.ewcert__dates {
  margin: 0.85cqw 0 0; font-size: 1.48cqw;
  display: flex; align-items: baseline; justify-content: center; gap: 0.55cqw; flex-wrap: wrap;
}
.ewcert__dates-label { color: #333; }
/* Dotted leaders, as on the printed form — the value sits in a ruled gap. */
.ewcert__dates-value {
  min-width: 15cqw; padding: 0 0.7cqw; font-weight: 700;
  border-bottom: 0.12cqw dotted rgba(17,17,17,0.55);
}
.ewcert__dates-year { font-weight: 700; padding-left: 0.3cqw; }
.ewcert__closing { margin: 0.7cqw 0 0; font-size: 1.48cqw; }

/* ---- Foot ---- */
.ewcert__foot {
  width: 100%;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 2cqw;
}
.ewcert__sign { display: flex; flex-direction: column; align-items: center; min-height: 6cqw; justify-content: flex-end; }
.ewcert__sign-ink { height: 4cqw; display: flex; align-items: flex-end; justify-content: center; }
.ewcert__sign-image { max-height: 4cqw; max-width: 22cqw; object-fit: contain; }
.ewcert__sign-script {
  font-family: "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive, serif;
  font-size: 3.1cqw; color: #16267a; line-height: 1;
}
.ewcert__sign-rule {
  display: block; width: 22cqw; height: 0; margin-top: 0.35cqw;
  border-bottom: 0.12cqw dotted rgba(17,17,17,0.55);
}
.ewcert__sign-name { margin: 0.35cqw 0 0; font-size: 1.35cqw; font-weight: 700; }
.ewcert__sign-role { margin: 0.3cqw 0 0; font-size: 1.4cqw; font-weight: 700; }

.ewcert__seal { width: 12cqw; }
.ewcert__seal-spacer { display: block; width: 12cqw; }
.ewcert__seal-svg { width: 100%; height: auto; display: block; }
.ewcert__seal-text {
  font-size: 11px; font-weight: 800; fill: #3A2A03;
  letter-spacing: 0.1em; text-transform: uppercase;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.ewcert__seal-level {
  font-size: 13px; font-weight: 800; fill: #F5D77A;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
}

/* ---- Verification ---- */
.ewcert__verify {
  margin-top: 0.7cqw; font-size: 1.02cqw; color: #444;
  display: flex; align-items: center; justify-content: center; gap: 0.6cqw; flex-wrap: wrap;
}
.ewcert__verify strong { font-weight: 700; color: #111; }
.ewcert__verify-sep { color: #aaa; }

/* ---- Disclaimer ---- */
.ewcert__disclaimer {
  margin-top: 0.5cqw; font-size: 0.9cqw; color: #666;
  font-weight: 500; letter-spacing: 0.02em;
}

/* ---- Stamps ---- */
.ewcert__stamp {
  position: absolute; right: 7cqw; bottom: 21cqw;
  transform: rotate(-13deg);
  border: 0.42cqw solid rgba(216, 30, 34, 0.72);
  color: rgba(216, 30, 34, 0.82);
  padding: 0.7cqw 1.6cqw; border-radius: 0.7cqw;
  display: flex; flex-direction: column; align-items: center;
  pointer-events: none;
}
.ewcert__stamp--revoked { border-color: rgba(60,60,60,0.72); color: rgba(60,60,60,0.85); }
.ewcert__stamp-title { font-size: 2.4cqw; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; }
.ewcert__stamp-sub { font-size: 0.95cqw; font-weight: 700; letter-spacing: 0.04em; }

@media print {
  .ewcert__sheet { box-shadow: none; }
  @page { size: A4 landscape; margin: 0; }
}
`;
