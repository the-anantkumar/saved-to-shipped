import { googleVerifier, firebaseAccountChecker } from '../src/auth/session';
import { providerJson, ProviderFailure } from '../src/providers/http';
interface Env { TEST_HTTP_ORIGIN: string }
export default { async fetch(request: Request, env: Env): Promise<Response> {
  const input = await request.json() as { operation: string; token: string };
  const forwarded: typeof fetch = (_url, options) => fetch(`${env.TEST_HTTP_ORIGIN}/${input.operation}`, options);
  try {
    if (input.operation === 'certificates') await googleVerifier(forwarded)(input.token, 'synthetic-project');
    else if (input.operation === 'account') await firebaseAccountChecker(forwarded)(input.token, 'synthetic-key');
    else await providerJson('Apify', `${env.TEST_HTTP_ORIGIN}/${input.operation}`, 'synthetic-only-key', fetch, { starting: true });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unknown',
      uncertain: error instanceof ProviderFailure && error.uncertain });
  }
} } satisfies ExportedHandler<Env>;
