import dynamic from 'next/dynamic';

const CaptainTerminal = dynamic(() => import('src/components/CaptainTerminal'), { ssr: false,
  loading: () => <main className="captain-boot" role="status">Loading Captain Hook terminal…</main> });

export default function Trader() { return <CaptainTerminal />; }
