import { jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Google identity or verified email/password plus TOTP. Key caching is in session.ts. */
export async function verifyGoogleToken(
  token: string,
  projectId: string,
  key: JWTVerifyGetKey,
  now = new Date(),
): Promise<{ uid: string }> {
  if (!projectId || token.length > 16_384) throw new Error('Invalid identity');
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    requiredClaims: ['sub', 'exp', 'iat', 'auth_time'],
    currentDate: now,
  });
  const seconds = Math.floor(now.getTime() / 1000);
  const firebase = payload.firebase as { sign_in_provider?: unknown; sign_in_second_factor?: unknown } | undefined;
  if (
    payload.aud !== projectId || typeof protectedHeader.kid !== 'string' || !protectedHeader.kid ||
    typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
    typeof payload.iat !== 'number' || payload.iat > seconds ||
    typeof payload.auth_time !== 'number' || payload.auth_time > seconds ||
    payload.auth_time < 0 || payload.iat < 0 ||
    !(firebase?.sign_in_provider === 'google.com' ||
      (firebase?.sign_in_provider === 'password' && payload.email_verified === true &&
        firebase.sign_in_second_factor === 'totp'))
  ) throw new Error('Invalid identity');
  return { uid: payload.sub };
}
