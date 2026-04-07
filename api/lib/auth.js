import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_KEY = process.env.JWT_SECRET;
const getSecret = () => new TextEncoder().encode(JWT_SECRET_KEY);

/**
 * Creates a signed JWT session token for the given userId.
 * Uses HS256 algorithm with a 7-day expiry.
 */
export async function createSessionToken(userId) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

/**
 * Verifies a JWT session token and returns the userId (sub claim),
 * or null if verification fails.
 */
export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Sets the session cookie on the response.
 * HttpOnly, SameSite=Lax, Path=/, Max-Age=604800 (7 days).
 * Adds Secure flag in production.
 */
export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`
  );
}

/**
 * Clears the session cookie by setting Max-Age=0.
 */
export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

/**
 * Parses the session cookie value from the request headers.
 * Returns the token string or null if not found.
 */
export function getSessionCookie(req) {
  return parseCookie(req.headers.cookie, "session");
}

/**
 * Parses the oauth_state cookie value from the request headers.
 * Returns the state string or null if not found.
 */
export function getOAuthStateCookie(req) {
  return parseCookie(req.headers.cookie, "oauth_state");
}

/**
 * Sets the oauth_state cookie on the response.
 * HttpOnly, SameSite=Lax, Path=/, Max-Age=600 (10 minutes).
 * Adds Secure flag in production.
 */
export function setOAuthStateCookie(res, state) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`
  );
}

/**
 * Retrieves and verifies the session cookie from the request.
 * Returns the userId or null if missing/invalid.
 */
export async function getUserFromRequest(req) {
  const token = getSessionCookie(req);
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Helper: parses a specific cookie name from a cookie header string.
 */
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}
