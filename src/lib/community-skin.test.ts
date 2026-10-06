import { describe, expect, it } from "vitest";

import { SKIN_DEFAULT_THEME, communitySkin } from "@/lib/community-skin";
import { chatThemeById } from "@/lib/chat-theme";

describe("communitySkin", () => {
  it("leaves the new look's community exactly as it is", () => {
    expect(communitySkin({ look: "youth", ready: true, isStaff: false })).toBe("plain");
  });

  it("gives the classic look the WhatsApp/Facebook-style chat", () => {
    expect(communitySkin({ look: "classic", ready: true, isStaff: false })).toBe("chat");
  });

  it("leaves staff on the neutral room, whatever look they hold", () => {
    expect(communitySkin({ look: "youth", ready: true, isStaff: true })).toBe("plain");
    expect(communitySkin({ look: "classic", ready: true, isStaff: true })).toBe("plain");
  });

  it("stays neutral until the look is known, rather than flashing the wrong chat", () => {
    expect(communitySkin({ look: "classic", ready: false, isStaff: false })).toBe("plain");
  });
});

describe("skin defaults", () => {
  it("starts every skin on a theme that exists", () => {
    for (const id of Object.values(SKIN_DEFAULT_THEME)) expect(chatThemeById(id).id).toBe(id);
  });

  it("keeps white text off the light bubble", () => {
    expect(chatThemeById("whatsapp").ink).toBeTruthy();
    expect(chatThemeById("sunset").ink).toBeUndefined();
  });

  it("falls back to the skin's theme, then to the brand one", () => {
    expect(chatThemeById(null, "whatsapp").id).toBe("whatsapp");
    expect(chatThemeById("nope", "whatsapp").id).toBe("whatsapp");
    expect(chatThemeById(null).id).toBe("classic");
  });
});
