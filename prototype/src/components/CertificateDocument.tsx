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
 *   app's theme variables. Wiring it to `var(--surface)` would mean a teal
 *   certificate turning white the day someone edits globals.css.
 * - `print-color-adjust: exact` is required or browsers drop the teal ground and
 *   the gold, and print a white page with black text.
 * - The PROVISIONAL stamp is driven by the LIVE balance (see
 *   `src/lib/certificates.ts`), so clearing tuition removes it. That is the
 *   consequence the pay-in-full offer promises, made visible on the document.
 *
 * It is bilingual because the school's own Teilnahmebestätigung is: German
 * line first, English gloss underneath, exactly as a Goethe/ÖSD-facing document
 * is read. A student forwarding this to a German employer or a consulate should
 * not have to explain what it says, and a student reading it at home should not
 * have to guess. The CEFR strip, the German grading scale and the RC number are
 * lifted from that document for the same reason: they are the marks a reader
 * already knows how to check.
 *
 * The ornament is doing a job. A certificate is read as evidence of worth
 * before a word of it is parsed, so the engine-turned ground, the double gold
 * rule, the corner fleurons and the wax seal are the argument: this is a
 * document you would frame, from a school that took your two months seriously.
 */

const MARK_SRC = "/logo-mark.png";

/** Straight off the school's letterhead. */
const SCHOOL = {
  name: "Easyway German Language School",
  address: "23 Unity Road, Off Toyin Street, Ikeja, Lagos, Nigeria",
  email: "info@easywaylanguageschool.com",
  phone: "+234 708 900 2534",
  rc: "RC: 3473394",
};

const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** The German title, chosen so neither document claims to be a Zeugnis. */
function germanTitle(kind: CertificateView["kind"]): string {
  return kind === "achievement" ? "Leistungsbestätigung" : "Teilnahmebestätigung";
}

/**
 * The German grading scale, verbatim from the school's document:
 * "mit sehr gutem Erfolg, mit gutem Erfolg, mit Erfolg".
 */
function germanResult(cert: CertificateView): string {
  if (cert.kind !== "achievement") return "hat am Kurs teilgenommen";
  if (cert.award === "distinction") return "mit sehr gutem Erfolg";
  if (cert.award === "merit") return "mit gutem Erfolg";
  return "mit Erfolg";
}

function englishResult(cert: CertificateView): string {
  if (cert.kind !== "achievement") return "attended the course";
  if (cert.award === "distinction") return "with great success";
  if (cert.award === "merit") return "with good success";
  return "with success";
}

export default function CertificateDocument({
  certificate,
  verifyBaseUrl = "",
}: {
  certificate: CertificateView;
  /** Absolute origin for the printed verification URL, e.g. https://portal.easyway.ng */
  verifyBaseUrl?: string;
}) {
  const cert = certificate;
  const longDate = (value: string) =>
    new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const shortDate = (value: string) =>
    new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const issued = longDate(cert.issuedAt);

  /**
   * The dates the course actually ran. An employer or a consulate reading this
   * needs to know WHEN the study happened, not only when the paper was printed
   * — "issued 12 August" says nothing about whether that was eight weeks of
   * study or one. Omitted rather than guessed on certificates issued before
   * these were recorded.
   */
  const courseDates =
    cert.courseStart && cert.courseEnd
      ? `${shortDate(cert.courseStart)} — ${shortDate(cert.courseEnd)}`
      : null;
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
            <p className="ewcert__school">{SCHOOL.name}</p>
            <p className="ewcert__sub">
              {cert.branchName ? `${cert.branchName} Branch` : "Lagos"} &middot; Goethe &amp; ÖSD Examination
              Preparation
            </p>
          </header>

          <p className="ewcert__title">{germanTitle(cert.kind)}</p>
          <p className="ewcert__titleen">{cert.title}</p>
          <div className="ewcert__titlerule">
            <span />
            <b>❖</b>
            <span />
          </div>

          <p className="ewcert__preamble">
            Hiermit wird bestätigt, dass
            <em>This is to certify that</em>
          </p>
          <p className="ewcert__name">{cert.studentName}</p>
          <div className="ewcert__namerule" />
          <p className="ewcert__namelabel">Vorname und Nachname &middot; First name and Surname</p>

          <p className="ewcert__citation">
            {germanCitation(cert)}
            <em>{cert.citation}</em>
          </p>

          {/* The CEFR strip. Every level is printed and one is lit, so the
              document says where the student stands on the scale a German
              employer already knows — not just which class they sat. */}
          <div className="ewcert__cefr">
            <span className="ewcert__cefrlabel">Referenzniveau des Kurses &middot; CEFR level of the course</span>
            <div className="ewcert__cefrrow">
              {CEFR_LEVELS.map((level) => (
                <span
                  key={level}
                  className={`ewcert__cefrcell${level === cert.level.toUpperCase() ? " is-earned" : ""}`}
                >
                  {level}
                </span>
              ))}
            </div>
          </div>

          <div className="ewcert__meta">
            <Field de="Bewertung" en="Award" value={cert.awardLabel} />
            {cert.averageScore !== null ? (
              <Field de="Gesamtergebnis" en="Overall" value={`${cert.averageScore}%`} />
            ) : null}
            {cert.studentCode ? <Field de="Matrikelnummer" en="Student ID" value={cert.studentCode} /> : null}
            {courseDates ? <Field de="Kursdauer" en="Course dates" value={courseDates} /> : null}
          </div>

          {/* The seal sits between the citation and the signatures rather than
              inside the signature row. In the row it was taller than the two
              name columns, so its award band dropped below their baseline and
              collided with them; here it also fills what was otherwise a dead
              band across the middle of the sheet. */}
          <div className="ewcert__sealblock">
            <Seal award={cert.awardLabel} level={cert.level} />
          </div>

          <p className="ewcert__scale">
            Die Bewertungsskala umfasst: mit sehr gutem Erfolg &middot; mit gutem Erfolg &middot; mit Erfolg.
            <em>The grading scale comprises: with great success, with good success, with success.</em>
          </p>

          <footer className="ewcert__foot">
            <Signature name={cert.tutorName ?? "&nbsp;"} de="Kursleiter/in" en="Course Tutor" />
            <div className="ewcert__place">
              <span className="ewcert__placevalue">Lagos &nbsp;·&nbsp; {issued}</span>
              <span className="ewcert__placelabel">Ort | Location &nbsp;·&nbsp; Datum | Date</span>
            </div>
            <Signature name="&nbsp;" de="Studienleitung" en="Director of Studies" />
          </footer>

          <div className="ewcert__ledger">
            <span>
              {SCHOOL.rc} &nbsp;·&nbsp; {cert.serial}
            </span>
            <span>
              {SCHOOL.address} &nbsp;·&nbsp; {SCHOOL.phone}
            </span>
            <span>
              {verifyUrl.replace(/^https?:\/\//, "")} &nbsp;·&nbsp; Code {cert.verifyCode}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The German half of the citation, mirroring `citationFor` in lib/certificates. */
function germanCitation(cert: CertificateView): string {
  const level = cert.level.toUpperCase();
  if (cert.kind === "achievement") {
    return `hat den Deutschkurs der Stufe ${level} an der Easyway German Language School ${germanResult(
      cert,
    )} abgeschlossen.`;
  }
  return `hat an einem Deutschkurs der Stufe ${level} an der Easyway German Language School regelmäßig teilgenommen (${englishResult(
    cert,
  )}).`;
}

function Field({ de, en, value }: { de: string; en: string; value: string }) {
  return (
    <div className="ewcert__field">
      <span className="ewcert__fieldvalue">{value}</span>
      <span className="ewcert__fieldlabel">
        {de} <i>| {en}</i>
      </span>
    </div>
  );
}

function Signature({ name, de, en }: { name: string; de: string; en: string }) {
  return (
    <div className="ewcert__sig">
      <span className="ewcert__signame" dangerouslySetInnerHTML={{ __html: name }} />
      <span className="ewcert__sigrule" />
      <span className="ewcert__sigrole">
        {de} <i>| {en}</i>
      </span>
    </div>
  );
}

/**
 * The engine-turned ground: fine concentric arcs, the same trick banknotes and
 * share certificates use. Cheap in SVG, and impossible to reproduce in a Word
 * document, which is the point for something people photograph and forward.
 *
 * Teal rather than navy — this is the school's own green, not a generic
 * diploma blue, and it is what makes the sheet recognisable at thumbnail size.
 */
function EngravedGround() {
  return (
    <svg className="ewcert__ground" viewBox="0 0 1188 840" preserveAspectRatio="none" aria-hidden>
      <defs>
        <radialGradient id="ewcert-glow" cx="50%" cy="0%" r="95%">
          <stop offset="0%" stopColor="#0f6d6b" />
          <stop offset="55%" stopColor="#08403f" />
          <stop offset="100%" stopColor="#04211f" />
        </radialGradient>
        {/* A warm bloom from the lower right, so the orange in the brand is
            present in the paper itself rather than only in the ink. */}
        <radialGradient id="ewcert-ember" cx="88%" cy="96%" r="62%">
          <stop offset="0%" stopColor="#FF6600" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#FF6600" stopOpacity="0" />
        </radialGradient>
        <pattern id="ewcert-guilloche" width="76" height="76" patternUnits="userSpaceOnUse">
          {[11, 21, 31, 41].map((r) => (
            <circle key={r} cx="38" cy="38" r={r} fill="none" stroke="#E9C46A" strokeWidth="0.4" opacity="0.14" />
          ))}
        </pattern>
      </defs>
      <rect width="1188" height="840" fill="url(#ewcert-glow)" />
      <rect width="1188" height="840" fill="url(#ewcert-guilloche)" />
      <rect width="1188" height="840" fill="url(#ewcert-ember)" />
    </svg>
  );
}

function Fleuron({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  return (
    <svg className={`ewcert__fleuron ewcert__fleuron--${position}`} viewBox="0 0 100 100" aria-hidden>
      <g fill="none" stroke="#E9C46A" strokeWidth="1.6" opacity="0.9">
        <path d="M4 30 C4 14 14 4 30 4" />
        <path d="M10 34 C10 20 20 10 34 10" opacity="0.6" />
        <path d="M12 12 C28 12 34 20 34 34 C22 34 12 26 12 12 Z" fill="#E9C46A" fillOpacity="0.18" />
        <circle cx="23" cy="23" r="2.6" fill="#FF8A33" stroke="none" />
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
            <stop offset="0%" stopColor="#FBEFC4" />
            <stop offset="32%" stopColor="#E9C46A" />
            <stop offset="62%" stopColor="#B8860B" />
            <stop offset="100%" stopColor="#FFB870" />
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
        <circle cx="100" cy="100" r="78" fill="#05302E" />
        <circle cx="100" cy="100" r="74" fill="none" stroke="url(#ewcert-gold)" strokeWidth="1.5" />

        <text className="ewcert__sealring" fill="#F3DFA8">
          <textPath href="#ewcert-sealpath" startOffset="50%" textAnchor="middle">
            · EASYWAY GERMAN LANGUAGE SCHOOL ·
          </textPath>
        </text>

        <text x="100" y="94" className="ewcert__sealmono" fill="url(#ewcert-gold)">
          EW
        </text>
        <text x="100" y="126" className="ewcert__seallevel" fill="#F3DFA8">
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
 *
 * Every bilingual pair uses the same trick: the German is the element's own
 * text and the English is an <em> or <i> forced onto its own line at a smaller
 * size. That keeps one DOM node per fact, so nothing can drift out of step.
 */
const CERT_CSS = `
.ewcert { container-type: inline-size; width: 100%; }
.ewcert__sheet {
  position: relative;
  aspect-ratio: 297 / 210;
  width: 100%;
  overflow: hidden;
  background: #05302E;
  color: #F5F1E6;
  font-family: Georgia, "Times New Roman", Cambria, serif;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.ewcert__ground { position: absolute; inset: 0; width: 100%; height: 100%; }

.ewcert__rule { position: absolute; pointer-events: none; }
.ewcert__rule--outer {
  inset: 2.2cqw;
  border: 0.42cqw solid transparent;
  border-image: linear-gradient(135deg, #FBEFC4, #E9C46A 28%, #FF8A33 55%, #B8860B 78%, #FBEFC4) 1;
}
.ewcert__rule--inner { inset: 3.4cqw; border: 0.12cqw solid rgba(233,196,106,0.55); }

.ewcert__fleuron { position: absolute; width: 7cqw; height: 7cqw; }
.ewcert__fleuron--tl { top: 3.1cqw; left: 3.1cqw; }
.ewcert__fleuron--tr { top: 3.1cqw; right: 3.1cqw; transform: scaleX(-1); }
.ewcert__fleuron--bl { bottom: 3.1cqw; left: 3.1cqw; transform: scaleY(-1); }
.ewcert__fleuron--br { bottom: 3.1cqw; right: 3.1cqw; transform: scale(-1,-1); }

.ewcert__body {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center;
  padding: 3.6cqw 7.4cqw 2.1cqw;
  text-align: center;
}

.ewcert__head { display: flex; flex-direction: column; align-items: center; }
.ewcert__crest {
  width: 5.2cqw; height: 5.2cqw; border-radius: 50%;
  display: grid; place-items: center;
  background: radial-gradient(circle at 30% 25%, #12807D, #05302E);
  box-shadow: 0 0 0 0.16cqw #E9C46A, 0 0 0 0.34cqw rgba(255,138,51,0.32);
}
.ewcert__mark { width: 78%; height: 78%; object-fit: contain; }
.ewcert__school {
  margin: 0.7cqw 0 0; font-size: 1.5cqw; letter-spacing: 0.3cqw;
  text-transform: uppercase; color: #F3DFA8; font-weight: 700;
}
.ewcert__sub { margin: 0.34cqw 0 0; font-size: 0.94cqw; letter-spacing: 0.1cqw; color: rgba(245,241,230,0.62); }

.ewcert__title {
  margin: 1cqw 0 0; font-size: 3.15cqw; line-height: 1; letter-spacing: 0.3cqw;
  text-transform: uppercase; font-weight: 700;
  background: linear-gradient(180deg, #FFF8E2 0%, #F6E3B6 26%, #E9C46A 58%, #FF9A45 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.ewcert__titleen {
  margin: 0.5cqw 0 0; font-size: 1.14cqw; letter-spacing: 0.3cqw;
  text-transform: uppercase; color: rgba(245,241,230,0.72); font-style: italic;
}
.ewcert__titlerule { display: flex; align-items: center; gap: 0.8cqw; margin-top: 0.55cqw; width: 40cqw; }
.ewcert__titlerule span { flex: 1; height: 0.09cqw; background: linear-gradient(90deg, transparent, #E9C46A, transparent); }
.ewcert__titlerule b { color: #FF9A45; font-size: 1.1cqw; }

.ewcert__preamble { margin: 0.9cqw 0 0; font-size: 1.14cqw; font-style: italic; color: rgba(245,241,230,0.75); }
.ewcert__preamble em { display: block; font-size: 0.86cqw; color: rgba(245,241,230,0.5); font-style: normal; }

.ewcert__name {
  margin: 0.4cqw 0 0; font-size: 3.9cqw; line-height: 1.05; font-style: italic; font-weight: 700;
  color: #FBEFC4; text-shadow: 0 0.12cqw 0.5cqw rgba(0,0,0,0.45);
}
.ewcert__namerule {
  margin-top: 0.55cqw; width: 52cqw; height: 0.1cqw;
  background: linear-gradient(90deg, transparent, rgba(233,196,106,0.9), transparent);
}
.ewcert__namelabel {
  margin: 0.34cqw 0 0; font-size: 0.72cqw; letter-spacing: 0.14cqw;
  text-transform: uppercase; color: rgba(245,241,230,0.45);
}

.ewcert__citation {
  margin: 0.85cqw 0 0; max-width: 62cqw; font-size: 1.2cqw; line-height: 1.45;
  color: rgba(245,241,230,0.92);
}
.ewcert__citation em { display: block; margin-top: 0.2cqw; font-size: 0.94cqw; color: rgba(245,241,230,0.58); }

/* The CEFR strip: all six printed, the earned one lit in brand orange. */
.ewcert__cefr { margin-top: 0.95cqw; display: flex; flex-direction: column; align-items: center; gap: 0.36cqw; }
.ewcert__cefrlabel {
  font-size: 0.7cqw; letter-spacing: 0.2cqw; text-transform: uppercase; color: rgba(233,196,106,0.8);
}
.ewcert__cefrrow { display: flex; gap: 0.5cqw; }
.ewcert__cefrcell {
  min-width: 4.6cqw; padding: 0.26cqw 0.7cqw; border-radius: 0.34cqw;
  border: 0.1cqw solid rgba(233,196,106,0.34);
  font-size: 1.06cqw; font-weight: 700; letter-spacing: 0.1cqw;
  color: rgba(245,241,230,0.42);
}
.ewcert__cefrcell.is-earned {
  border-color: #FFB870;
  background: linear-gradient(135deg, #FF8A33, #FF6600);
  color: #2A1200;
  box-shadow: 0 0.2cqw 0.7cqw rgba(255,102,0,0.45);
}

.ewcert__meta { display: flex; gap: 3.4cqw; margin-top: 0.9cqw; }
.ewcert__field { display: flex; flex-direction: column; gap: 0.16cqw; }
.ewcert__fieldvalue { font-size: 1.36cqw; font-weight: 700; color: #F5F1E6; }
.ewcert__fieldlabel {
  font-size: 0.68cqw; letter-spacing: 0.16cqw; text-transform: uppercase; color: rgba(233,196,106,0.85);
}
.ewcert__fieldlabel i { font-style: normal; color: rgba(245,241,230,0.42); }

/* Auto margins top AND bottom centre the seal in whatever space the citation
   leaves, so a short citation and a long one both look composed. */
.ewcert__sealblock { margin: auto 0; }

.ewcert__scale {
  margin: 0 0 0.5cqw; max-width: 70cqw; font-size: 0.7cqw; line-height: 1.35;
  color: rgba(245,241,230,0.5);
}
.ewcert__scale em { display: block; font-size: 0.66cqw; color: rgba(245,241,230,0.36); }

.ewcert__foot {
  width: 100%;
  display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; gap: 2.4cqw;
}
.ewcert__sig { display: flex; flex-direction: column; align-items: center; gap: 0.28cqw; }
.ewcert__signame { font-size: 1.36cqw; font-style: italic; color: #F5F1E6; min-height: 1.7cqw; }
.ewcert__sigrule { width: 17cqw; height: 0.09cqw; background: rgba(233,196,106,0.7); }
.ewcert__sigrole {
  font-size: 0.7cqw; letter-spacing: 0.16cqw; text-transform: uppercase; color: rgba(245,241,230,0.62);
}
.ewcert__sigrole i { font-style: normal; color: rgba(245,241,230,0.4); }

.ewcert__place { display: flex; flex-direction: column; align-items: center; gap: 0.28cqw; }
.ewcert__placevalue { font-size: 0.96cqw; color: rgba(245,241,230,0.82); }
.ewcert__placelabel {
  font-size: 0.64cqw; letter-spacing: 0.14cqw; text-transform: uppercase; color: rgba(245,241,230,0.4);
}

.ewcert__sealwrap { display: flex; flex-direction: column; align-items: center; gap: 0.45cqw; }
.ewcert__seal { width: 9.4cqw; height: 9.4cqw; filter: drop-shadow(0 0.3cqw 0.7cqw rgba(0,0,0,0.5)); }
.ewcert__sealring { font-size: 13px; letter-spacing: 2.6px; font-family: Georgia, serif; }
.ewcert__sealmono { font-size: 46px; font-weight: 700; text-anchor: middle; font-family: Georgia, serif; }
.ewcert__seallevel { font-size: 20px; letter-spacing: 4px; text-anchor: middle; font-family: Georgia, serif; }
.ewcert__sealband {
  font-size: 0.82cqw; letter-spacing: 0.22cqw; text-transform: uppercase; font-weight: 700;
  color: #2A1200; background: linear-gradient(135deg, #FBEFC4, #E9C46A 55%, #FF9A45);
  padding: 0.22cqw 1cqw; border-radius: 0.3cqw;
}

.ewcert__ledger {
  display: flex; justify-content: space-between; gap: 1.6cqw;
  width: 100%; margin-top: 0.7cqw;
  font-size: 0.7cqw; letter-spacing: 0.04cqw; color: rgba(245,241,230,0.5);
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
