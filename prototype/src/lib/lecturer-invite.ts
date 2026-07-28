import { promises as fs } from "fs";
import path from "path";

const inviteFilePath = path.join(process.cwd(), "data", "lecturer-invite.json");

async function ensureInviteFile() {
  await fs.mkdir(path.dirname(inviteFilePath), { recursive: true });

  try {
    await fs.access(inviteFilePath);
  } catch {
    await fs.writeFile(inviteFilePath, JSON.stringify({ code: "" }), "utf8");
  }
}

export async function getLecturerInviteCode() {
  await ensureInviteFile();

  try {
    const raw = await fs.readFile(inviteFilePath, "utf8");
    const parsed = JSON.parse(raw) as { code?: string };
    return typeof parsed.code === "string" ? parsed.code.trim() : "";
  } catch {
    return "";
  }
}

export async function setLecturerInviteCode(code: string) {
  await ensureInviteFile();
  await fs.writeFile(inviteFilePath, JSON.stringify({ code: code.trim() }), "utf8");
}

export async function clearLecturerInviteCode() {
  await ensureInviteFile();
  await fs.writeFile(inviteFilePath, JSON.stringify({ code: "" }), "utf8");
}
