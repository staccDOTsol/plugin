import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import type { AppProps } from 'next/app';
import 'tailwindcss/tailwind.css';
import '../styles/globals.css';
import '../styles/trader.css';

// The upstream configurator's formatters and demo chrome are loaded only for
// /demo, so the trading page has no dependency on those browser bundles.
const UpstreamDemoShell = dynamic(() => import('src/components/UpstreamDemoShell'), { ssr: false });

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  return router.pathname === '/demo'
    ? <UpstreamDemoShell Component={Component} pageProps={pageProps} />
    : <Component {...pageProps} />;
}
