import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/server/env';
import { endSession } from '@/lib/server/session';

export async function POST(req: NextRequest) {
  // Same-origin form post only.
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(env().PUBLIC_URL).origin) return new NextResponse('Forbidden', { status: 403 });
  await endSession();
  return NextResponse.redirect(`${env().PUBLIC_URL}/`, { status: 303 });
}
