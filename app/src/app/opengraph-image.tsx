import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { CAMPUS } from "@/data/campus";

export const alt = `${CAMPUS.app.name}, ${CAMPUS.app.description}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const icon = readFileSync(join(process.cwd(), "public", "icons", "og-icon.png")).toString("base64");
  const accent = CAMPUS.theme.accent ?? "#1d4ed8";
  const onAccent = CAMPUS.theme.accentForeground ?? "#ffffff";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 64,
        padding: "0 96px",
        background: accent,
        color: onAccent,
      }}>
      <div
        style={{
          display: "flex",
          padding: 18,
          borderRadius: 86,
          background: "rgba(255, 255, 255, 0.16)",
          boxShadow: "0 24px 60px rgba(0, 20, 60, 0.35)",
        }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/png;base64,${icon}`} width={300} height={300} alt="" style={{ borderRadius: 68 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640 }}>
        <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1 }}>{CAMPUS.app.name}</div>
        <div style={{ fontSize: 38, lineHeight: 1.25, opacity: 0.9 }}>{CAMPUS.app.description}</div>
        <div style={{ fontSize: 26, opacity: 0.75 }}>Room search · Walking directions · Class schedule</div>
      </div>
    </div>,
    size,
  );
}
