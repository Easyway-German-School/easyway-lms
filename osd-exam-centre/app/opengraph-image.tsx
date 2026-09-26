import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const alt = "Easyway ÖSD Examination Centre — sit your ÖSD German exam in Lagos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link preview shown when the site is shared (WhatsApp, iMessage, Slack…).
export default async function OpenGraphImage() {
  const bg = await readFile(path.join(process.cwd(), "assets", "og-bg.jpg"));
  const src = `data:image/jpeg;base64,${bg.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex",
            background: "linear-gradient(90deg, rgba(7,19,40,0.94) 0%, rgba(7,19,40,0.62) 55%, rgba(7,19,40,0.12) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex",
            flexDirection: "column", justifyContent: "flex-end", padding: 64, color: "white",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64,
                borderRadius: 32, border: "2px solid #e3b94f", color: "#e3b94f", fontSize: 26, fontWeight: 700,
              }}
            >
              EW
            </div>
            <div style={{ display: "flex", marginLeft: 20, fontSize: 24, letterSpacing: 6, color: "#e3b94f" }}>
              ÖSD PRÜFUNGSZENTRUM · LAGOS
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.05, maxWidth: 860 }}>
            Your German exam in Lagos.
          </div>
          <div style={{ display: "flex", fontSize: 40, color: "#e3b94f", marginTop: 16, maxWidth: 860 }}>
            Book your ÖSD seat online.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
