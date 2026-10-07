import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0];
  if (['hooksare.fun', 'www.hooksare.fun', 'www.captainhook.fun'].includes(host || '')) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, 'https://captainhook.fun');
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = { matcher: '/:path*' };
