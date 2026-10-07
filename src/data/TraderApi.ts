// Fixed build-time origin; link parameters cannot redirect a wallet to a
// different transaction builder.
const configuredOrigin = process.env.NEXT_PUBLIC_THOOOK_TRADER_API_ORIGIN || 'https://api.captainhook.fun';
export const TRADER_API_ORIGIN = configuredOrigin.replace(/\/$/, '');

export function traderUrl(path: string) {
  return `${TRADER_API_ORIGIN}${path}`;
}

export interface HookedOrcaPrepareResponse {
  routeKind: 'hooked-orca';
  stage: 'setup' | 'swap';
  chain: 'mainnet-beta';
  buyer: string;
  inputMint: string;
  outputMint: string;
  inputRaw: string;
  expectedOutputRaw: string;
  minimumOutputRaw: string;
  estimatedInputRaw: string;
  amountMode: 'exact' | 'max';
  marketMint: string;
  pools: string[];
  hookProgram: string;
  accounts: Record<string, string>;
  routePlan: { swapInfo: { ammKey: string; label: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string }; percent: number }[];
  sourceTransfers?: { source: string; amountRaw: string }[];
  preparationToken: string;
  slippageBps: number;
  transaction: string;
  message: string;
  transactionBytes: number;
  computeUnits: number;
}

export interface TraderSubmitResponse {
  signature: string;
}

export interface TraderStatusResponse {
  confirmed: boolean;
  err: unknown;
  inputAmountResult?: string;
  outputAmountResult?: string;
}

export interface AuctionState {
  mint: string;
  auction: string;
  ready: boolean;
  error?: string;
  round: string;
  phase: 'open' | 'live' | 'ended';
  minBidLamports: string;
  incrementBps: number;
  durationSeconds: number;
  extensionSeconds: number;
  startedAt: number;
  endsAt: number;
  serverUnixSeconds: number;
  highBidLamports: string;
  highBidder: string | null;
  proposedHook: string | null;
  minNextBidLamports: string;
  paymentRecipient: string;
  retainedAuthority: string;
  lastWinner: string | null;
  lastWinningHook: string | null;
  lastPaidLamports: string;
  lastWonAt: number;
}

export interface MarketState {
  id: string;
  mint: string;
  label: string;
  name: string;
  decimals: number;
  pool: string;
  hookProgram: string;
  hookAuthority: string;
  heldRaw: string | null;
  eligible: boolean | null;
  auction: AuctionState;
}

export interface MarketResponse {
  brand: string;
  chain: string;
  defaultMint: string;
  checkedAt: string;
  markets: MarketState[];
}

export interface AuctionPreparation {
  chain: 'mainnet-beta';
  engine: 'auction';
  stage: 'bid';
  buyer: string;
  mint: string;
  round: string;
  bidLamports: string;
  minNextBidLamports: string;
  previousBidder: string;
  previousBidLamports: string;
  endsAt: number;
  durationSeconds: number;
  extensionSeconds: number;
  paymentRecipient: string;
  retainedAuthority: string;
  programId: string;
  eaml: string;
  holding: string;
  transaction: string;
  preparationToken: string;
  message: string;
}

export interface SettleResult {
  mint: string;
  action: 'settled' | 'waiting' | 'proof-failed' | 'voided' | 'void-failed' | 'busy' | 'unavailable' | 'error';
  round?: string;
  signature?: string | null;
  phase?: string;
  endsAt?: number;
  retryUntil?: number;
  error?: string;
}

export interface LiquidityAmount { mint: string; raw: string; ui: string }
export interface LiquidityPair { tokenA: LiquidityAmount; tokenB: LiquidityAmount }
export interface LiquidityConfig {
  address: string;
  public: boolean;
  feeAuthority: string;
  badgeAuthority: string | null;
  controlsFees: boolean;
  controlsBadges: boolean;
  splashFeeTier: { address: string; feeRateBps: number | null } | null;
  badges: Record<string, boolean>;
  missingBadges: string[];
  usable: boolean;
  needsBadgeStep: boolean;
}
export interface LiquidityPool {
  address: string;
  config: string;
  tickSpacing: number;
  splash: boolean;
  feeRateBps: number;
  liquidity: string;
  priceTokenBPerTokenA: string;
  priceCounterPerMint: string;
  tokenVaultA: string;
  tokenVaultB: string;
}
export interface LiquidityPosition {
  address: string;
  mint: string;
  liquidity: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
  feeOwedA: string;
  feeOwedB: string;
  fullRange: boolean;
}
export interface LiquidityOverview {
  chain: 'mainnet-beta';
  mint: { address: string; decimals: number; tokenProgram: string; extensions: string[]; hookProgram: string | null; badgeRequired: boolean; symbol: string | null };
  counter: { address: string; decimals: number; tokenProgram: string; extensions: string[]; hookProgram: string | null; badgeRequired: boolean; symbol: string | null };
  order: { tokenA: string; tokenB: string; inverted: boolean; explanation: string };
  pricing: { source: string; mintUsd: number; counterUsd: number; updatedAt: number | null; counterPerMint: string; tokenBPerTokenA: string } | null;
  pools: LiquidityPool[];
  pool: LiquidityPool | null;
  fullRange: { lowerTick: number; upperTick: number; tickSpacing: number };
  positions: LiquidityPosition[];
  configs: LiquidityConfig[];
  configCount: number;
  config: LiquidityConfig | null;
  plan: { id: 'badge' | 'pool' | 'open' | 'manage'; label: string; done: boolean }[];
  warnings: string[];
  feeRateOptions: number[];
  defaultFeeRateBps: number;
}
export type LiquidityAction = 'badge' | 'pool' | 'open' | 'increase' | 'decrease' | 'collect' | 'close';
export interface LiquidityPreparation {
  chain: 'mainnet-beta';
  engine: 'liquidity';
  stage: LiquidityAction;
  wallet: string;
  mint: string;
  counter: string;
  tokenA: string;
  tokenB: string;
  inverted: boolean;
  transaction: string;
  ephemeralSigners: string[];
  preparationToken: string;
  message: string;
  config?: string;
  pool?: string;
  position?: string;
  positionMint?: string;
  tickLowerIndex?: number;
  tickUpperIndex?: number;
  feeRateBps?: number;
  badges?: string[];
  priceCounterPerMint?: string;
  priceTokenBPerTokenA?: string;
  initialTick?: number;
  tickArrays?: number[];
  liquidity?: string;
  estimate?: LiquidityPair;
  maximum?: LiquidityPair;
  withdrawn?: { liquidity: string; estimate: LiquidityPair; minimum: LiquidityPair } | null;
  feesOwed?: LiquidityPair;
  percentBps?: number;
  slippageBps?: number;
}

export class TraderRequestError extends Error {
  code: string;
  constructor(message: string, code = 'TRADER_ERROR') { super(message); this.code = code; }
}

export async function traderJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(traderUrl(path), { cache: 'no-store', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new TraderRequestError(data?.error || data?.message || `Trader request failed (${response.status}).`, data?.code);
  }
  return data as T;
}
