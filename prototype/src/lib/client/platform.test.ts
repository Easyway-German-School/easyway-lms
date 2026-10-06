import { describe, expect, it } from "vitest";
import { detectInstallEnv } from "./platform";

const iphone = (os: string, tail: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${tail}`;

describe("detectInstallEnv", () => {
  it("recognises Safari on an iPhone 14 Pro (iOS 17)", () => {
    const env = detectInstallEnv(iphone("17_4", "Version/17.4 Mobile/15E148 Safari/604.1"));
    expect(env).toMatchObject({ ios: true, android: false, browser: "safari", iosTooOldForPush: false });
  });

  it("recognises Chrome, Firefox and Edge on iPhone as installable browsers, not Safari", () => {
    expect(detectInstallEnv(iphone("17_4", "CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1")).browser).toBe("chrome");
    expect(detectInstallEnv(iphone("17_4", "FxiOS/125.0 Mobile/15E148 Safari/605.1.15")).browser).toBe("firefox");
    expect(detectInstallEnv(iphone("17_4", "EdgiOS/124.0 Version/17.0 Mobile/15E148 Safari/605.1.15")).browser).toBe("edge");
  });

  it("flags in-app browsers, which cannot Add to Home Screen", () => {
    // Instagram / Facebook announce themselves.
    expect(detectInstallEnv(iphone("17_4", "Mobile/15E148 Instagram 320.0.0.12.108 (iPhone14,7; iOS 17_4)")).browser).toBe("inapp");
    expect(detectInstallEnv(iphone("17_4", "Mobile/15E148 [FBAN/FBIOS;FBAV/450.0])")).browser).toBe("inapp");
    // WhatsApp / Gmail / Notion embed a bare WKWebView: no "Safari/" token at all.
    expect(detectInstallEnv(iphone("17_4", "Mobile/15E148")).browser).toBe("inapp");
  });

  it("treats an iPad in desktop mode as iOS, and a real Mac as not", () => {
    const macUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    expect(detectInstallEnv(macUa, 5).ios).toBe(true);
    expect(detectInstallEnv(macUa, 0).ios).toBe(false);
    // No version in that UA: never tell a current iPad to update.
    expect(detectInstallEnv(macUa, 5).iosTooOldForPush).toBe(false);
  });

  it("knows iOS 16.4 is the first version with web push", () => {
    const tail = "Version/16.0 Mobile/15E148 Safari/604.1";
    expect(detectInstallEnv(iphone("15_8", tail)).iosTooOldForPush).toBe(true);
    expect(detectInstallEnv(iphone("16_3", tail)).iosTooOldForPush).toBe(true);
    expect(detectInstallEnv(iphone("16_4", tail)).iosTooOldForPush).toBe(false);
    expect(detectInstallEnv(iphone("16_10", tail)).iosTooOldForPush).toBe(false);
    expect(detectInstallEnv(iphone("26_0", tail)).iosTooOldForPush).toBe(false);
  });

  it("recognises Android Chrome and Android web views", () => {
    const chrome = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    expect(detectInstallEnv(chrome)).toMatchObject({ android: true, ios: false, browser: "chrome" });
    const webview = "Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36";
    expect(detectInstallEnv(webview).browser).toBe("inapp");
  });
});
