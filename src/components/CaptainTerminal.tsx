import Head from 'next/head';
import Script from 'next/script';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UnifiedWalletButton, UnifiedWalletProvider, useWallet } from '@jup-ag/wallet-adapter';
import { Buffer } from 'buffer';
import { VersionedTransaction } from '@solana/web3.js';
import { CONTROLLED_MARKETS, CONTROLLER, THOOOK_HOOK, USDC_MINT, WSOL_MINT } from 'src/data/HookedOrcaRoutes';
import {
  AuctionPreparation, LiquidityAction, LiquidityOverview, LiquidityPreparation, MarketResponse, SettleResult, TraderStatusResponse, traderJson,
} from 'src/data/TraderApi';
import { validateCaptainBid, validateCaptainLiquidity } from 'src/data/ValidateCaptainTransaction';

const short = (value: string) => `${value.slice(0, 5)}…${value.slice(-5)}`;
const sol = (raw: string | bigint) => (Number(raw) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 6 });
const tokenAmount = (raw: string, decimals: number) => (Number(raw) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 6 });
const explorer = (address: string) => `https://solscan.io/account/${address}`;
const clock = (seconds: number) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;
const toRaw = (ui: string, decimals: number) => {
  if (!/^\d*\.?\d*$/.test(ui) || !ui || ui === '.') return null;
  const [whole = '0', fraction = ''] = ui.split('.');
  const raw = BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
  return raw > BigInt(0) ? raw.toString() : null;
};
const trim = (value: string, digits = 8) => Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, maximumSignificantDigits: 10 });
type Signer = NonNullable<ReturnType<typeof useWallet>['signTransaction']>;

async function waitForConfirmation(signature: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const status = await traderJson<TraderStatusResponse>(`/api/trader/status/${signature}`);
    if (status.err) throw new Error('The transaction reverted on-chain. Refresh and inspect the receipt.');
    if (status.confirmed) return;
  }
  throw new Error('The transaction is still pending. Check its receipt before trying again.');
}

function TerminalSurface() {
  const wallet = useWallet();
  const [selected, setSelected] = useState<string>(CONTROLLED_MARKETS[0].mint);
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [tab, setTab] = useState<'trade' | 'auction' | 'liquidity'>('trade');
  const [feed, setFeed] = useState<MarketResponse | null>(null);
  const [feedError, setFeedError] = useState('');
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'error'>('idle');
  const [program, setProgram] = useState(THOOOK_HOOK);
  const [bidSol, setBidSol] = useState('');
  const [auctionBusy, setAuctionBusy] = useState(false);
  const [auctionStatus, setAuctionStatus] = useState('');
  const [auctionTone, setAuctionTone] = useState<'idle' | 'error' | 'success'>('idle');
  const [auctionSignature, setAuctionSignature] = useState('');
  const [history, setHistory] = useState<{ signature: string; label: string }[]>([]);
  const [now, setNow] = useState(Date.now());
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const market = feed?.markets.find((market) => market.mint === selected);
  const registry = CONTROLLED_MARKETS.find((market) => market.mint === selected);
  const allTokens = selected === 'ultra';
  const buyer = wallet.publicKey?.toBase58();

  // Splash Pool wizard state
  const [lqMint, setLqMint] = useState<string>(CONTROLLED_MARKETS[0].mint);
  const [lqCounter, setLqCounter] = useState<string>(WSOL_MINT);
  const [overview, setOverview] = useState<LiquidityOverview | null>(null);
  const [lqBusy, setLqBusy] = useState(false);
  const [lqStatus, setLqStatus] = useState('');
  const [lqTone, setLqTone] = useState<'idle' | 'error' | 'success'>('idle');
  const [lqSignature, setLqSignature] = useState('');
  const [lqPrice, setLqPrice] = useState('');
  const [lqFeeRate, setLqFeeRate] = useState(3000);
  const [lqConfig, setLqConfig] = useState('');
  const [depositSide, setDepositSide] = useState<'counter' | 'mint'>('counter');
  const [depositUi, setDepositUi] = useState('');
  const [preview, setPreview] = useState<LiquidityPreparation | null>(null);
  const [managePosition, setManagePosition] = useState('');
  const [manageAction, setManageAction] = useState<'increase' | 'decrease' | 'collect' | 'close'>('increase');
  const [withdrawPercent, setWithdrawPercent] = useState(50);
  const busy = swapBusy || auctionBusy || lqBusy;

  const connect = useCallback(() => {
    document.querySelector<HTMLButtonElement>('#captain-wallet button')?.click();
  }, []);
  const refresh = useCallback(async () => {
    try {
      const current = walletRef.current.publicKey?.toBase58();
      const result = await traderJson<MarketResponse>(`/api/trader/markets${current ? `?wallet=${current}` : ''}`);
      setFeed(result); setFeedError('');
    } catch (error) { setFeedError(error instanceof Error ? error.message : 'Live market data unavailable.'); }
  }, []);
  useEffect(() => {
    refresh(); const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh, buyer]);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []);

  useEffect(() => {
    if (!scriptReady || !window.Jupiter?.init) return;
    const input = allTokens ? WSOL_MINT : direction === 'buy' ? WSOL_MINT : selected;
    const output = allTokens ? USDC_MINT : direction === 'buy' ? selected : WSOL_MINT;
    const initialAmount = allTokens || direction === 'buy' ? '5000000' : registry?.decimals === 6 ? '100000' : '100000000';
    window.Jupiter.init({ displayMode: 'integrated', integratedTargetId: 'captain-swap',
      containerStyles: { maxWidth: '100%', minHeight: '550px', height: 'auto', borderRadius: 0 },
      formProps: { initialInputMint: input, initialOutputMint: output, initialAmount,
        swapMode: allTokens ? 'ExactInOrOut' : 'ExactIn', fixedMint: allTokens ? undefined : selected },
      branding: { name: 'Captain Hook', logoUri: '/captain-hook.svg' }, defaultExplorer: 'Solscan',
      enableWalletPassthrough: true, passthroughWalletContextState: walletRef.current,
      onRequestConnectWallet: connect,
      onScreenUpdate: (screen) => setSwapBusy(screen === 'Swapping'),
      onSuccess: ({ txid }) => { setSwapBusy(false); setHistory((items) => [{ signature: txid, label: 'Trade confirmed' }, ...items].slice(0, 6)); refresh(); },
      onSwapError: () => setSwapBusy(false),
    });
    return () => { window.Jupiter?.root?.unmount(); };
  }, [scriptReady, selected, direction, allTokens, registry?.decimals, connect, refresh]);
  useEffect(() => {
    if (scriptReady && window.Jupiter?.syncProps) window.Jupiter.syncProps({ passthroughWalletContextState: wallet });
  }, [scriptReady, wallet]);
  useEffect(() => {
    setAuctionStatus(''); setAuctionSignature(''); setAuctionTone('idle'); setCopied('idle'); setBidSol('');
    if (selected !== 'ultra') setLqMint(selected);
  }, [selected]);

  const auction = market?.auction;
  const clockDelta = feed ? Math.max(0, Math.floor((now - new Date(feed.checkedAt).getTime()) / 1000)) : 0;
  const unixNow = auction?.ready ? auction.serverUnixSeconds + clockDelta : 0;
  const secondsLeft = auction?.ready && auction.phase !== 'open' ? auction.endsAt - unixNow : 0;
  const livePhase = !auction?.ready ? 'open' : auction.phase === 'open' ? 'open' : secondsLeft > 0 ? 'live' : 'ended';
  const inSnipeWindow = livePhase === 'live' && auction?.ready && secondsLeft <= auction.extensionSeconds;
  const leaderIsYou = Boolean(auction?.highBidder && buyer && auction.highBidder === buyer);
  const minNextSol = auction?.ready ? Number(auction.minNextBidLamports) / 1e9 : 0;
  const bidLamports = useMemo(() => toRaw(bidSol || (auction?.ready ? String(minNextSol) : ''), 9), [bidSol, auction, minNextSol]);
  const bidTooLow = Boolean(auction?.ready && bidLamports && BigInt(bidLamports) < BigInt(auction.minNextBidLamports));
  const feedFresh = Boolean(feed && now - new Date(feed.checkedAt).getTime() < 45000 && !feedError);

  async function copyMint() {
    try { await navigator.clipboard.writeText(selected); setCopied('copied'); }
    catch { setCopied('error'); }
    setTimeout(() => setCopied('idle'), 2000);
  }

  async function placeBid() {
    if (!buyer || !wallet.signTransaction) { connect(); return; }
    if (!market || !auction?.ready || !bidLamports) return;
    setAuctionBusy(true); setAuctionTone('idle'); setAuctionSignature('');
    try {
      setAuctionStatus('Checking the live round, your holdings, and the proposed hook…');
      const prepared = await traderJson<AuctionPreparation>('/api/trader/auction/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint: selected, buyer, programId: program.trim(), round: auction.round, bidLamports }),
      });
      if (prepared.mint !== selected || prepared.programId !== program.trim() || prepared.buyer !== buyer || prepared.bidLamports !== bidLamports) throw new Error('Bid preparation changed the selected terms.');
      const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, 'base64'));
      validateCaptainBid(tx, prepared, buyer);
      setAuctionStatus(`Simulation passed. Approve escrowing ${sol(prepared.bidLamports)} SOL for round ${prepared.round}. ${prepared.message}`);
      const signed = await wallet.signTransaction(tx);
      setAuctionStatus('Signature received. Relaying your bid…');
      const result = await traderJson<{ signature: string; round: string }>('/api/trader/auction/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTransaction: Buffer.from(signed.serialize()).toString('base64'), preparationToken: prepared.preparationToken }),
      });
      setAuctionSignature(result.signature); setAuctionStatus('Bid submitted. Waiting for mainnet confirmation…');
      await waitForConfirmation(result.signature);
      setAuctionTone('success'); setAuctionStatus(`You lead round ${prepared.round} with ${sol(prepared.bidLamports)} SOL. If someone outbids you, your SOL is refunded automatically.`);
      setHistory((items) => [{ signature: result.signature, label: `Bid ${sol(prepared.bidLamports)} SOL · round ${prepared.round}` }, ...items].slice(0, 6));
      setBidSol('');
      await refresh();
    } catch (error) { setAuctionTone('error'); setAuctionStatus(error instanceof Error ? error.message : 'Bid could not be placed.'); }
    finally { setAuctionBusy(false); }
  }

  async function settleNow() {
    setAuctionBusy(true); setAuctionTone('idle');
    try {
      setAuctionStatus('Asking the seller’s authority to settle this round…');
      const result = await traderJson<SettleResult>('/api/trader/auction/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint: selected }) });
      if (result.action === 'settled') { setAuctionTone('success'); setAuctionStatus(`Round ${result.round} settled to the highest bidder. The next round is live.`); if (result.signature) setAuctionSignature(result.signature); }
      else if (result.action === 'voided') { setAuctionStatus('The winning hook could not pass the transfer proof, so the leader was refunded and a new round opened.'); }
      else if (result.action === 'proof-failed') { setAuctionTone('error'); setAuctionStatus('The winning hook fails the checked-transfer proof. Settlement retries until the grace period ends, then the leader is refunded.'); }
      else if (result.action === 'waiting') setAuctionStatus('This round is still live.');
      else setAuctionStatus(result.error || `Settlement status: ${result.action}.`);
      await refresh();
    } catch (error) { setAuctionTone('error'); setAuctionStatus(error instanceof Error ? error.message : 'Settlement request failed.'); }
    finally { setAuctionBusy(false); }
  }

  const loadOverview = useCallback(async (mint: string, counter: string) => {
    setLqBusy(true); setLqTone('idle'); setPreview(null);
    try {
      const current = walletRef.current.publicKey?.toBase58();
      const result = await traderJson<LiquidityOverview>(`/api/trader/liquidity/overview?mint=${encodeURIComponent(mint.trim())}&counter=${counter}${current ? `&wallet=${current}` : ''}`);
      setOverview(result); setLqStatus('');
      setLqPrice(result.pricing?.counterPerMint ? trim(result.pricing.counterPerMint, 12).replace(/,/g, '') : '');
      setLqConfig(result.config?.address || '');
      setLqFeeRate(result.config?.splashFeeTier?.feeRateBps || result.defaultFeeRateBps);
      setManagePosition(result.positions[0]?.address || '');
    } catch (error) { setOverview(null); setLqTone('error'); setLqStatus(error instanceof Error ? error.message : 'Could not read this pair.'); }
    finally { setLqBusy(false); }
  }, []);

  async function runLiquidity(action: LiquidityAction, extra: Record<string, unknown>, prepared?: LiquidityPreparation) {
    if (!buyer || !wallet.signTransaction) { connect(); return; }
    setLqBusy(true); setLqTone('idle'); setLqSignature('');
    try {
      if (!prepared) {
        setLqStatus('Simulating this step on mainnet…');
        prepared = await traderJson<LiquidityPreparation>('/api/trader/liquidity/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, wallet: buyer, mint: lqMint.trim(), counter: lqCounter, ...extra }) });
      }
      const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, 'base64'));
      validateCaptainLiquidity(tx, prepared, buyer);
      setLqStatus(`Simulation passed. ${prepared.message}`);
      const signed = await wallet.signTransaction(tx);
      setLqStatus('Signature received. Relaying…');
      const result = await traderJson<{ signature: string }>('/api/trader/liquidity/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTransaction: Buffer.from(signed.serialize()).toString('base64'), preparationToken: prepared.preparationToken }) });
      setLqSignature(result.signature); setLqStatus('Submitted. Waiting for mainnet confirmation…');
      await waitForConfirmation(result.signature);
      setLqTone('success');
      setLqStatus({ badge: 'Badge and fee tier are live on your config. Next: initialize the pool.', pool: 'Splash Pool initialized with its tick arrays. Next: open a position and deposit.',
        open: 'Position opened and funded. You are now providing liquidity.', increase: 'Liquidity added.', decrease: 'Liquidity withdrawn and fees collected.', collect: 'Fees collected.', close: 'Position closed and rent refunded.' }[action]);
      setHistory((items) => [{ signature: result.signature, label: { badge: 'Token badge issued', pool: 'Splash Pool initialized', open: 'Position opened', increase: 'Liquidity increased', decrease: 'Liquidity withdrawn', collect: 'Fees collected', close: 'Position closed' }[action] }, ...items].slice(0, 6));
      setPreview(null); setDepositUi('');
      await loadOverview(lqMint, lqCounter);
    } catch (error) { setLqTone('error'); setLqStatus(error instanceof Error ? error.message : 'This step could not be completed.'); }
    finally { setLqBusy(false); }
  }

  async function previewDeposit(action: 'open' | 'increase') {
    if (!buyer || !overview?.pool) { if (!buyer) connect(); return; }
    const side = depositSide === 'counter' ? overview.counter : overview.mint;
    const inputRaw = toRaw(depositUi, side.decimals);
    if (!inputRaw) { setLqTone('error'); setLqStatus('Enter a positive deposit amount.'); return; }
    setLqBusy(true); setLqTone('idle'); setPreview(null);
    try {
      setLqStatus('Quoting the matching deposit at the current pool price…');
      const prepared = await traderJson<LiquidityPreparation>('/api/trader/liquidity/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, wallet: buyer, mint: lqMint.trim(), counter: lqCounter, pool: overview.pool.address, inputMint: side.address, inputRaw, position: managePosition || undefined, slippageBps: 100 }) });
      setPreview(prepared); setLqStatus(prepared.message);
    } catch (error) { setLqTone('error'); setLqStatus(error instanceof Error ? error.message : 'Could not quote this deposit.'); }
    finally { setLqBusy(false); }
  }

  const holderText = !buyer ? 'Connect wallet to check access' : market?.eligible === true ? 'Existing holder · eligible'
    : market?.eligible === false ? 'Zero balance · access denied' : 'Checking wallet holdings…';
  const symbol = (address: string) => address === lqMint.trim() ? overview?.mint.symbol || 'token' : overview?.counter.symbol || 'counter';
  const sideLabel = (pair: { tokenA: { mint: string; ui: string }; tokenB: { mint: string; ui: string } }) => `${trim(pair.tokenA.ui)} ${symbol(pair.tokenA.mint)} + ${trim(pair.tokenB.ui)} ${symbol(pair.tokenB.mint)}`;
  const stepIndex = overview ? overview.plan.findIndex((step) => !step.done) : -1;
  const selectedPosition = overview?.positions.find((position) => position.address === managePosition);

  return <>
    <Head>
      <title>Captain Hook — hooked-token router, hook auctions & Splash Pools</title>
      <meta name="description" content="Buy and sell controlled Token-2022 mints with hook-aware routes, bid in always-on English hook auctions with anti-snipe extension, and set up Orca Splash Pools step by step." />
      <meta name="theme-color" content="#100f0c" />
      <link rel="canonical" href="https://captainhook.fun/" />
      <link rel="icon" href="/captain-hook.svg" type="image/svg+xml" />
    </Head>
    <Script src="/plugin-1.0.16.js" strategy="afterInteractive" onLoad={() => setScriptReady(true)} onError={() => setScriptError(true)} />
    <div className="captain-page">
      <a className="captain-skip" href="#captain-main">Skip to terminal</a>
      <header className="captain-header">
        <Link className="captain-brand" href="/" aria-label="Captain Hook home"><Image src="/captain-hook.svg" alt="" width={35} height={35} unoptimized /><span>CAPTAIN HOOK<small>.FUN / SOLANA</small></span></Link>
        <nav aria-label="Terminal sections" className="captain-navigation">
          <button aria-pressed={tab === 'trade'} onClick={() => setTab('trade')}>Trade</button>
          <button aria-pressed={tab === 'auction'} onClick={() => setTab('auction')}>Hook auctions</button>
          <button aria-pressed={tab === 'liquidity'} onClick={() => { setTab('liquidity'); if (!overview && !lqBusy) loadOverview(lqMint, lqCounter); }}>Liquidity</button>
          <a href="https://project.captainhook.fun/#proof" target="_blank" rel="noopener noreferrer">Mainnet proof ↗</a>
        </nav>
        <div id="captain-wallet"><UnifiedWalletButton /></div>
      </header>
      <main id="captain-main" className="captain-main">
        <div className="captain-marketbar">
          <div><p className="captain-overline">HOOK-AWARE EXECUTION</p><h1>{tab === 'trade' ? 'Trade with the hook on.' : tab === 'auction' ? 'Outbid. Extend. Win the hook.' : 'Splash Pool, step by step.'}</h1></div>
          <label className="captain-market-select" htmlFor="captain-market"><span>Select mint</span><select id="captain-market" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
            {CONTROLLED_MARKETS.map((market) => <option key={market.mint} value={market.mint}>{market.label} · {market.name}</option>)}
            <option value="ultra">All tokens · Jupiter Ultra</option>
          </select></label>
          <div className={`captain-chain ${feedFresh ? 'is-live' : ''}`} role="status"><i /> {feedFresh ? 'MAINNET LIVE' : 'CHECKING MAINNET'}</div>
        </div>
        {feedError && <div className="captain-banner is-error" role="alert">{feedError}<button onClick={refresh}>Retry</button></div>}
        {!allTokens && tab !== 'liquidity' && <div className="captain-access-row"><span className={`captain-access ${market?.eligible === true ? 'is-eligible' : market?.eligible === false ? 'is-denied' : ''}`}>{holderText}</span>
          <span>Recipients must hold this same mint before a transfer. Zero-balance first buys revert.</span>
          <button onClick={copyMint} aria-label="Copy selected mint">{copied === 'copied' ? 'Copied ✓' : copied === 'error' ? 'Copy failed' : `${short(selected)} / COPY`}</button>
        </div>}
        <div className="captain-workspace">
          <section className="captain-console" aria-label="Trading terminal" style={{ display: tab === 'trade' ? undefined : 'none' }}>
            <div className="captain-console-head"><div className="captain-direction" aria-label="Trade direction">
              <button aria-pressed={direction === 'buy'} disabled={busy || allTokens} onClick={() => setDirection('buy')}>{allTokens ? 'Swap' : 'Buy'}</button>
              {!allTokens && <button aria-pressed={direction === 'sell'} disabled={busy} onClick={() => setDirection('sell')}>Sell</button>}
            </div><span>{allTokens ? 'JUPITER ULTRA' : `${registry?.label} / SOL`}</span></div>
            {!scriptReady && !scriptError && <div className="captain-loading" role="status"><span /> Loading the Jupiter Terminal fork…</div>}
            {scriptError && <div className="captain-banner is-error" role="alert">Terminal could not load. <button onClick={() => location.reload()}>Reload</button></div>}
            <div id="captain-swap" className="captain-swap" />
            <div className="captain-console-foot">Your wallet signs. The complete hooked trade is simulated before approval.</div>
          </section>

          <section className="captain-auction-console" aria-labelledby="captain-auction-title" style={{ display: tab === 'auction' ? undefined : 'none' }}>
            <div className="captain-panel-heading"><p className="captain-overline">ENGLISH AUCTION · ANTI-SNIPE</p><h2 id="captain-auction-title">Set the next hook.</h2></div>
            {allTokens ? <p className="captain-empty">Choose XEEu, 5oCp, or DZVf to open a live hook auction.</p> : !auction?.ready ? <p className="captain-empty">{auction?.error || 'Reading the on-chain auction…'}</p> : <>
              <div className="captain-ask">
                <div><span>{auction.highBidder ? 'Leading bid' : 'Opening bid'} / round {auction.round}</span><strong>{sol(auction.highBidder ? auction.highBidLamports : auction.minBidLamports)} <small>SOL</small></strong>
                  <em className="captain-leader">{auction.highBidder ? leaderIsYou ? 'You are the leader' : `Leader ${short(auction.highBidder)}` : 'No bids yet'}</em></div>
                <div><span>{livePhase === 'open' ? 'Clock' : livePhase === 'live' ? inSnipeWindow ? 'Ends in · anti-snipe armed' : 'Ends in' : 'Bidding closed'}</span>
                  <strong className={`captain-clock ${inSnipeWindow ? 'is-hot' : ''}`}>{livePhase === 'open' ? clock(auction.durationSeconds) : livePhase === 'live' ? clock(secondsLeft) : 'SETTLING'}</strong></div>
              </div>
              <p className="captain-auction-terms">Bids escrow real SOL on-chain. Each raise must beat the leader by {auction.incrementBps / 100}%, and the outbid wallet is refunded in the same instruction. The first bid starts a {Math.round(auction.durationSeconds / 60)}-minute clock; any bid in the final {Math.round(auction.extensionSeconds / 60)} minutes pushes the end out by {Math.round(auction.extensionSeconds / 60)} minutes, so nobody can snipe at the buzzer. When the clock runs out, the seller’s authority settles: payment, hook change, and a checked-transfer proof through the winning hook, atomically.</p>
              <label className="captain-field">Your bid in SOL<input value={bidSol} inputMode="decimal" onChange={(event) => setBidSol(event.target.value)} disabled={auctionBusy || livePhase === 'ended'} placeholder={minNextSol.toLocaleString('en-US', { maximumFractionDigits: 9 })} /></label>
              <p className={`captain-field-note ${bidTooLow ? 'is-error' : ''}`}>{bidTooLow ? `Too low. The minimum raise right now is ${sol(auction.minNextBidLamports)} SOL.` : `Minimum right now: ${sol(auction.minNextBidLamports)} SOL. Leave blank to bid exactly that.`}</p>
              <label className="captain-field">Your deployed hook program<input value={program} onChange={(event) => setProgram(event.target.value)} disabled={auctionBusy} spellCheck={false} placeholder="Mainnet program address" /></label>
              <p className="captain-field-note">If you win, this program becomes {registry?.label}’s transfer hook. Its ExtraAccountMetaList must already be wired for {registry?.label}; settlement proves a checked transfer through it, and a hook that cannot pass gets your bid refunded instead.</p>
              {livePhase === 'ended'
                ? <button className="captain-primary" disabled={busy} onClick={settleNow}>{auctionBusy ? 'Settling…' : `Settle round ${auction.round} now ↗`}</button>
                : <button className="captain-primary" disabled={busy || Boolean(buyer && market?.eligible !== true) || !program.trim() || bidTooLow} onClick={placeBid}>
                  {auctionBusy ? 'Placing bid…' : !buyer ? 'Connect wallet to bid' : market?.eligible !== true ? 'Existing holder required' : auction.highBidder ? leaderIsYou ? 'Raise your own bid ↗' : 'Outbid the leader ↗' : 'Place the opening bid ↗'}
                </button>}
              <div className={`captain-auction-status ${auctionTone !== 'idle' ? `is-${auctionTone}` : ''}`} role={auctionTone === 'error' ? 'alert' : 'status'} aria-live="polite">{auctionStatus || 'You sign your own bid; nothing is co-signed. 331n settles finished rounds and keeps the literal hook authority.'}
                {auctionSignature && <a href={`https://solscan.io/tx/${auctionSignature}`} target="_blank" rel="noopener noreferrer">View receipt ↗</a>}</div>
              {auction.lastWinner && <p className="captain-field-note">Last round: {short(auction.lastWinner)} paid {sol(auction.lastPaidLamports)} SOL for hook {auction.lastWinningHook ? short(auction.lastWinningHook) : '—'}.</p>}
            </>}
          </section>

          <section className="captain-liquidity-console" aria-labelledby="captain-liquidity-title" style={{ display: tab === 'liquidity' ? undefined : 'none' }}>
            <div className="captain-panel-heading"><p className="captain-overline">SPLASH POOL FOR DUMMIES</p><h2 id="captain-liquidity-title">Price it, pool it, fund it.</h2></div>
            <div className="captain-pair-row">
              <label className="captain-field">Token mint<input value={lqMint} onChange={(event) => setLqMint(event.target.value)} spellCheck={false} disabled={lqBusy} placeholder="Token-2022 or SPL mint address" /></label>
              <label className="captain-field">Paired with<select value={lqCounter} disabled={lqBusy} onChange={(event) => setLqCounter(event.target.value)}><option value={WSOL_MINT}>SOL</option><option value={USDC_MINT}>USDC</option></select></label>
              <button className="captain-secondary" disabled={lqBusy || !lqMint.trim()} onClick={() => loadOverview(lqMint, lqCounter)}>{lqBusy && !overview ? 'Reading…' : 'Read pair ↗'}</button>
            </div>
            {overview && <>
              <ol className="captain-steps">{overview.plan.map((step, index) => <li key={step.id} aria-current={index === stepIndex ? 'step' : undefined}><span>{index + 1}</span>{step.label}</li>)}</ol>
              {overview.warnings.map((warning) => <div key={warning} className="captain-banner is-warn" role="alert">{warning}</div>)}
              <dl className="captain-readout captain-readout-tight">
                <dt>Orca token order</dt><dd>A = {symbol(overview.order.tokenA)} · B = {symbol(overview.order.tokenB)}{overview.order.inverted ? ' · inverted' : ''}</dd>
                <dt>Birdeye price</dt><dd>{overview.pricing ? `1 ${overview.mint.symbol || 'token'} ≈ ${trim(overview.pricing.counterPerMint, 12)} ${overview.counter.symbol} ($${trim(String(overview.pricing.mintUsd), 10)})` : 'No price yet · enter one below'}</dd>
                {overview.pricing && <><dt>Orca raw price (B per A)</dt><dd>{trim(overview.pricing.tokenBPerTokenA, 12)}</dd></>}
                <dt>Mint</dt><dd>{overview.mint.decimals} decimals · {overview.mint.extensions.length ? overview.mint.extensions.join(', ') : 'plain SPL'}{overview.mint.hookProgram ? ` · hook ${short(overview.mint.hookProgram)}` : ''}</dd>
                <dt>Pool</dt><dd>{overview.pool ? <><a href={explorer(overview.pool.address)} target="_blank" rel="noopener noreferrer">{short(overview.pool.address)} ↗</a> · {overview.pool.splash ? 'Splash' : `spacing ${overview.pool.tickSpacing}`} · {overview.pool.feeRateBps / 100}% fee · 1 {overview.mint.symbol || 'token'} = {trim(overview.pool.priceCounterPerMint, 12)} {overview.counter.symbol}</> : 'None yet for this pair'}</dd>
                {!overview.pool && <><dt>Config</dt><dd>{overview.config ? <>{overview.config.public ? 'Orca public config' : `${short(overview.config.address)}${overview.config.controlsBadges ? ' · you hold badge authority' : ' · already badges this mint'}`}{overview.config.splashFeeTier ? ` · ${(overview.config.splashFeeTier.feeRateBps || 0) / 100}% Splash tier` : ' · no Splash tier yet'}</> : 'None usable'}</dd></>}
              </dl>
              <p className="captain-inspector-note">{overview.order.explanation}</p>

              {!overview.pool && overview.config && (() => {
                const step = overview.plan[Math.max(0, stepIndex)]?.id;
                if (step === 'badge') return <div className="captain-step-card"><h3>Step 1 · Token badge & fee tier</h3>
                  <p>Orca only lets a pool vault hold a Token-2022 mint with a transfer hook once its config carries a token badge. Orca’s program no longer lets wallets create new configs, so this uses a config you already control.</p>
                  {!overview.config.splashFeeTier && <div className="captain-choice" role="radiogroup" aria-label="Fee rate">{overview.feeRateOptions.map((rate) => <button key={rate} role="radio" aria-checked={lqFeeRate === rate} onClick={() => setLqFeeRate(rate)} disabled={lqBusy}>{rate / 100}% fee</button>)}</div>}
                  <button className="captain-primary" disabled={busy || !overview.config.controlsBadges} onClick={() => runLiquidity('badge', { config: lqConfig, feeRateBps: lqFeeRate })}>{!buyer ? 'Connect wallet' : overview.config.controlsBadges ? 'Issue badge on my config ↗' : 'Wallet is not badge authority'}</button></div>;
                return <div className="captain-step-card"><h3>Step {stepIndex + 1} · Initialize the Splash Pool</h3>
                  <p>Set the starting price in {overview.counter.symbol} per {overview.mint.symbol || 'token'}. {overview.order.inverted ? 'Orca stores the inverse (token per counter) because of address ordering; the wizard converts it, so type the price the normal way.' : 'This matches Orca’s own direction for this pair.'} Full-range liquidity means the pool quotes every price, and the first trade moves it.</p>
                  <label className="captain-field">Starting price · {overview.counter.symbol} per {overview.mint.symbol || 'token'}<input value={lqPrice} inputMode="decimal" onChange={(event) => setLqPrice(event.target.value)} disabled={lqBusy} placeholder={overview.pricing ? trim(overview.pricing.counterPerMint, 12) : 'e.g. 0.0000025'} /></label>
                  {lqPrice && Number(lqPrice) > 0 && <p className="captain-field-note">Orca will store {overview.order.inverted ? trim(String(1 / Number(lqPrice)), 12) : trim(lqPrice, 12)} (token B per token A).{overview.pricing ? ` Birdeye reference: ${trim(overview.pricing.counterPerMint, 12)}.` : ''}</p>}
                  <button className="captain-primary" disabled={busy || !(Number(lqPrice) > 0)} onClick={() => runLiquidity('pool', { config: lqConfig, priceCounterPerMint: lqPrice })}>{!buyer ? 'Connect wallet' : 'Initialize pool + tick arrays ↗'}</button></div>;
              })()}

              {overview.pool && <div className="captain-step-card"><h3>{overview.positions.length ? 'Open another full-range position' : 'Open a full-range position'}</h3>
                <p>Enter how much of one side to deposit; the other side is matched at the current pool price. Your wallet never spends more than the maximums shown.</p>
                <div className="captain-pair-row">
                  <label className="captain-field">Amount<input value={depositUi} inputMode="decimal" onChange={(event) => { setDepositUi(event.target.value); setPreview(null); }} disabled={lqBusy} placeholder="0.0" /></label>
                  <label className="captain-field">Token<select value={depositSide} disabled={lqBusy} onChange={(event) => { setDepositSide(event.target.value as 'counter' | 'mint'); setPreview(null); }}><option value="counter">{overview.counter.symbol}</option><option value="mint">{overview.mint.symbol || short(overview.mint.address)}</option></select></label>
                  <button className="captain-secondary" disabled={busy || !depositUi} onClick={() => previewDeposit('open')}>Preview ↗</button>
                </div>
                {preview?.stage === 'open' && preview.estimate && preview.maximum && <dl className="captain-readout captain-readout-tight"><dt>Deposits about</dt><dd>{sideLabel(preview.estimate)}</dd><dt>Never more than</dt><dd>{sideLabel(preview.maximum)}</dd><dt>Range</dt><dd>Full range · ticks {preview.tickLowerIndex} → {preview.tickUpperIndex}</dd></dl>}
                <button className="captain-primary" disabled={busy || preview?.stage !== 'open'} onClick={() => preview && runLiquidity('open', {}, preview)}>{!buyer ? 'Connect wallet' : preview?.stage === 'open' ? 'Approve & deposit ↗' : 'Preview first'}</button></div>}

              {overview.pool && overview.positions.length > 0 && <div className="captain-step-card"><h3>Manage your positions</h3>
                <div className="captain-pair-row">
                  <label className="captain-field">Position<select value={managePosition} disabled={lqBusy} onChange={(event) => { setManagePosition(event.target.value); setPreview(null); }}>{overview.positions.map((position) => <option key={position.address} value={position.address}>{short(position.address)} · liq {trim(position.liquidity, 0)}{position.fullRange ? '' : ' · custom range'}</option>)}</select></label>
                  <label className="captain-field">Action<select value={manageAction} disabled={lqBusy} onChange={(event) => { setManageAction(event.target.value as typeof manageAction); setPreview(null); }}><option value="increase">Increase liquidity</option><option value="decrease">Withdraw some</option><option value="collect">Collect fees</option><option value="close">Withdraw all & close</option></select></label>
                </div>
                {selectedPosition && <p className="captain-field-note">Fees owed: {tokenAmount(selectedPosition.feeOwedA, overview.order.tokenA === overview.mint.address ? overview.mint.decimals : overview.counter.decimals)} {symbol(overview.order.tokenA)} + {tokenAmount(selectedPosition.feeOwedB, overview.order.tokenB === overview.mint.address ? overview.mint.decimals : overview.counter.decimals)} {symbol(overview.order.tokenB)} (updated on each liquidity change).</p>}
                {manageAction === 'increase' && <><div className="captain-pair-row">
                  <label className="captain-field">Amount<input value={depositUi} inputMode="decimal" onChange={(event) => { setDepositUi(event.target.value); setPreview(null); }} disabled={lqBusy} placeholder="0.0" /></label>
                  <label className="captain-field">Token<select value={depositSide} disabled={lqBusy} onChange={(event) => { setDepositSide(event.target.value as 'counter' | 'mint'); setPreview(null); }}><option value="counter">{overview.counter.symbol}</option><option value="mint">{overview.mint.symbol || short(overview.mint.address)}</option></select></label>
                  <button className="captain-secondary" disabled={busy || !depositUi} onClick={() => previewDeposit('increase')}>Preview ↗</button></div>
                  {preview?.stage === 'increase' && preview.estimate && preview.maximum && <dl className="captain-readout captain-readout-tight"><dt>Adds about</dt><dd>{sideLabel(preview.estimate)}</dd><dt>Never more than</dt><dd>{sideLabel(preview.maximum)}</dd></dl>}
                  <button className="captain-primary" disabled={busy || preview?.stage !== 'increase'} onClick={() => preview && runLiquidity('increase', {}, preview)}>{preview?.stage === 'increase' ? 'Approve & add ↗' : 'Preview first'}</button></>}
                {manageAction === 'decrease' && <><label className="captain-field">Withdraw {withdrawPercent}%<input type="range" min={1} max={100} value={withdrawPercent} disabled={lqBusy} onChange={(event) => setWithdrawPercent(Number(event.target.value))} /></label>
                  <button className="captain-primary" disabled={busy} onClick={() => runLiquidity('decrease', { pool: overview.pool?.address, position: managePosition, percentBps: withdrawPercent * 100, slippageBps: 100 })}>Withdraw {withdrawPercent}% + collect fees ↗</button></>}
                {manageAction === 'collect' && <button className="captain-primary" disabled={busy} onClick={() => runLiquidity('collect', { pool: overview.pool?.address, position: managePosition })}>Collect fees ↗</button>}
                {manageAction === 'close' && <button className="captain-primary" disabled={busy} onClick={() => runLiquidity('close', { pool: overview.pool?.address, position: managePosition, slippageBps: 100 })}>Withdraw everything & close ↗</button>}
              </div>}
            </>}
            <div className={`captain-auction-status ${lqTone !== 'idle' ? `is-${lqTone}` : ''}`} role={lqTone === 'error' ? 'alert' : 'status'} aria-live="polite">{lqStatus || 'Every step is one wallet-signed transaction, simulated on mainnet before you approve. Prices come from Birdeye; Orca’s address-based token order is handled for you.'}
              {lqSignature && <a href={`https://solscan.io/tx/${lqSignature}`} target="_blank" rel="noopener noreferrer">View receipt ↗</a>}</div>
          </section>

          <aside className="captain-inspector">
            <section className="captain-route-panel"><div className="captain-panel-title"><h2>Execution route</h2><span>LIVE / WALLET-SIGNED</span></div>
              <div className="captain-route-flow"><span>{allTokens ? 'Any supported token' : direction === 'buy' ? 'SOL' : registry?.label}</span><i>→</i><span>{allTokens ? 'Jupiter Ultra' : registry?.id === 'five' ? 'Raydium CP + Orca V2' : registry?.id === 'dzvf' ? 'Orca V2 · USDC bridge' : 'Best Orca V2 route'}</span><i>→</i><span>{allTokens ? 'Selected token' : direction === 'buy' ? registry?.label : 'SOL'}</span></div>
              <dl className="captain-readout"><dt>Ordinary routes</dt><dd>Jupiter Ultra</dd><dt>Hooked routes</dt><dd>Direct V2 + resolved hook accounts</dd><dt>Wallet balance</dt><dd>{market?.heldRaw != null ? `${tokenAmount(market.heldRaw, market.decimals)} ${market.label}` : buyer ? 'Checking…' : 'Connect wallet'}</dd>
                <dt>Hook program</dt><dd>{market?.hookProgram ? <a href={explorer(market.hookProgram)} target="_blank" rel="noopener noreferrer">{short(market.hookProgram)} ↗</a> : '—'}</dd>
                <dt>Retained authority</dt><dd><a href={explorer(CONTROLLER)} target="_blank" rel="noopener noreferrer">331n…76Mth ↗</a></dd><dt>Platform fee</dt><dd>0% on direct routes</dd></dl>
              <p className="captain-inspector-note">Quote, holder eligibility, and the entire transaction are checked together. Unsupported or failing routes return a specific error before signing.</p>
            </section>
            {!allTokens && <section className="captain-auction-mini"><div className="captain-panel-title"><h2>Hook auction</h2><span>ROUND {auction?.round || '—'}</span></div>
              <div className="captain-mini-price"><strong>{auction?.ready ? sol(auction.highBidder ? auction.highBidLamports : auction.minBidLamports) : '—'} <small>SOL</small></strong><span>{!auction?.ready ? 'Reading on-chain terms…' : livePhase === 'open' ? 'no bids · clock starts on first bid' : livePhase === 'live' ? `${clock(secondsLeft)} left${inSnipeWindow ? ' · extends on bid' : ''}` : 'closed · settling'}</span></div>
              <p>{auction?.highBidder ? `${leaderIsYou ? 'You lead' : `${short(auction.highBidder)} leads`}. Next raise: ${sol(auction.minNextBidLamports)} SOL.` : 'Highest escrowed bid wins when the clock runs out. Late bids extend it.'}</p><button className="captain-text-button" onClick={() => setTab(tab === 'auction' ? 'trade' : 'auction')}>{tab === 'auction' ? 'Back to trading ↗' : 'Open live auction ↗'}</button>
            </section>}
            <section className="captain-activity"><div className="captain-panel-title"><h2>This session</h2><span>CONFIRMED RECEIPTS</span></div>
              {history.length ? <ul>{history.map((item) => <li key={item.signature}><span>{item.label}</span><a href={`https://solscan.io/tx/${item.signature}`} target="_blank" rel="noopener noreferrer">{short(item.signature)} ↗</a></li>)}</ul>
                : <p className="captain-empty">Your confirmed trades, bids, and liquidity steps appear here.</p>}
            </section>
          </aside>
        </div>
        <section className="captain-market-table" aria-label="Controlled hooked markets"><div className="captain-panel-title"><h2>The hooked markets</h2><span>LIVE FROM MAINNET</span></div>
          <div className="captain-table-scroll"><table><thead><tr><th>Mint</th><th>Access</th><th>Auction round</th><th>Leading bid · SOL</th><th>Clock</th><th>Market</th></tr></thead><tbody>
            {(feed?.markets || CONTROLLED_MARKETS.map((market) => ({ ...market, eligible: null, auction: null }))).map((market) => <tr key={market.mint} aria-selected={selected === market.mint}>
              <td><button disabled={busy} onClick={() => setSelected(market.mint)}><strong>{market.label}</strong><small>{short(market.mint)}</small></button></td>
              <td>{market.eligible === true ? 'Holder verified' : market.eligible === false ? 'No holdings' : 'Wallet not checked'}</td><td>{market.auction?.round || '—'}</td>
              <td>{market.auction?.ready ? market.auction.highBidder ? sol(market.auction.highBidLamports) : `opens at ${sol(market.auction.minBidLamports)}` : '—'}</td>
              <td>{market.auction?.ready ? market.auction.phase === 'open' ? 'waiting for first bid' : market.auction.phase === 'live' ? clock(market.auction.endsAt - market.auction.serverUnixSeconds - clockDelta) : 'settling' : '—'}</td>
              <td><a href={explorer(market.pool)} target="_blank" rel="noopener noreferrer">Pool ↗</a></td>
            </tr>)}</tbody></table></div>
        </section>
      </main>
      <footer className="captain-footer"><span>CAPTAINHOOK.FUN / SOLANA MAINNET</span><span>JUPITER TERMINAL FORK · HOOK-AWARE ROUTER · ENGLISH HOOK AUCTIONS · SPLASH POOLS</span></footer>
    </div>
  </>;
}

export default function CaptainTerminal() {
  return <UnifiedWalletProvider wallets={[]} config={{ env: 'mainnet-beta', autoConnect: true,
    metadata: { name: 'Captain Hook', description: 'Hook-aware trading, English hook auctions, and Splash Pools', url: 'https://captainhook.fun', iconUrls: ['https://captainhook.fun/captain-hook.svg'] },
    theme: 'jupiter' }}><TerminalSurface /></UnifiedWalletProvider>;
}
