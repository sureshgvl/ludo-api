import { UnauthorizedException } from "@nestjs/common";
import { config } from "../config";

export interface GoogleProfile { sub: string; email: string; name: string }

/** Checks a Google ID token with Google's own endpoint and makes sure it was issued for our app. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!config.googleClientIds.length) throw new UnauthorizedException("Google login is not configured on the server");
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  } catch {
    throw new UnauthorizedException("Could not reach Google to verify your login");
  }
  const c: any = await res.json().catch(() => ({}));
  const issuerOk = c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com";
  if (!res.ok || !issuerOk || !config.googleClientIds.includes(c.aud) || String(c.email_verified) !== "true" || !c.sub || Number(c.exp) * 1000 < Date.now()) {
    throw new UnauthorizedException("Google login could not be verified");
  }
  return { sub: String(c.sub), email: String(c.email ?? ""), name: String(c.name ?? c.given_name ?? "Player") };
}
