import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui';
import { currentUser } from '@/lib/server/session';

export const metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  invalid_state: 'Your sign-in link expired or was tampered with. Please try again.',
  token_exchange: 'Discord did not accept the sign-in. Check DISCORD_CLIENT_SECRET and the redirect URL in the developer portal.',
  profile: 'Could not read your Discord profile.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (await currentUser()) redirect(next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
  const href = `/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm rounded-2xl border border-coal-700 bg-coal-900 p-8 text-center">
        <p aria-hidden className="mb-3 text-4xl">🍳</p>
        <h1 className="mb-2 text-2xl font-bold">Sign in to BotCooks</h1>
        <p className="mb-6 text-sm text-coal-400">We only ask Discord for your username and the list of servers you are in.</p>
        {error ? (
          <div className="mb-4 text-left">
            <Alert tone="danger">{ERRORS[error] ?? 'Sign-in failed.'}</Alert>
          </div>
        ) : null}
        <a href={href} className="block rounded-lg bg-[#5865F2] px-4 py-3 font-semibold text-white hover:bg-[#4752c4]">
          Continue with Discord
        </a>
      </div>
    </main>
  );
}
