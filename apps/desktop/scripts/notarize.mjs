import { notarize } from "@electron/notarize";

export default async function notarizeAfterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.SECOND_DESKTOP_SKIP_NOTARIZE === "1") return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const appBundleId = "com.second.desktop";
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;

  if (!appleId || !appleIdPassword || !teamId) {
    if (process.env.CI === "true") {
      throw new Error(
        "Missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID for macOS notarization.",
      );
    }
    console.warn("Skipping macOS notarization because Apple credentials are not set.");
    return;
  }

  await notarize({
    appBundleId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
}
