import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1f3a",
          color: "#b8912f",
          fontSize: 15,
          fontWeight: 700,
          borderRadius: "50%",
          fontFamily: "serif",
        }}
      >
        EW
      </div>
    ),
    size,
  );
}
