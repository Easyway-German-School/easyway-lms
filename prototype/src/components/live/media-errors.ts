/**
 * Turns a getUserMedia failure into something a student can act on.
 *
 * Every browser words these differently and none of them words them usefully.
 * "NotAllowedError" on screen is indistinguishable from the app being broken,
 * and a student who believes the app is broken leaves the class rather than
 * fixing a setting they were never told about.
 *
 * Shared by the lobby's pre-flight check and the classroom itself, so a student
 * gets the same instructions whether the camera fails before the lesson or
 * halfway through it.
 */
export function mediaErrorMessage(error: unknown, device: "camera" | "microphone"): string {
  const name = error instanceof Error ? error.name : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return `Your browser is blocking the ${device}. Tap the padlock (or the camera icon) in the address bar, set ${device} to Allow, then reload this page. On Android Chrome it is ⋮ → Settings → Site settings; on iPhone it is Settings → Safari → Camera.`;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return `No ${device} was found on this device.`;
    case "NotReadableError":
    case "TrackStartError":
      return `Another app is already using your ${device}. Close Zoom, WhatsApp or your camera app and try again.`;
    case "OverconstrainedError":
      return `Your ${device} does not support the quality we asked for. Try a lower video quality.`;
    case "SecurityError":
      return `This page is not on a secure connection, so the browser will not share your ${device}.`;
    default:
      return error instanceof Error && error.message
        ? `Could not start your ${device}: ${error.message}`
        : `Could not start your ${device}.`;
  }
}
