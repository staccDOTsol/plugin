// Known Token-2022 hook mints are intercepted before asking Jupiter to build
// a transaction. Add a market here only after its direct route is live.
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const XEEU_MINT = 'XEEu6i2pqjsZn63spYuyDCd5yizaE1pJ7iPbNPW1oMo';
export const XEEU_POOL = '9zST8JLNeJXH518mDmAQRiKfYtoG8AymytyoEK8pkdfa';
export const THOOOK_HOOK = 'VwcGiFProGtfYLKsDpJuxZoYMFZpuZ1XT6MGmBd9AwU';
export const CONTROLLER = '331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const GGO8_MINT = 'GGo8ee2DkuX2oFminYuBphMwEiQ5BdCzyYd84Nnm24R5';
export const ORCA_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
export const RAYDIUM_PROGRAM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
export const SOL_USDC_POOL = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
export const SOL_GGO8_POOL = '2mEgtAUVfoNHbNNBph2WtAR54m7GoHe3sGwM4WYCYe5o';

export const CONTROLLED_MARKETS = [
  { id: 'xeeu', mint: XEEU_MINT, label: 'XEEu', name: 'Captain Hook', decimals: 9,
    pool: XEEU_POOL, counterMint: WSOL_MINT, usdcPool: 'FnfJEV3FgH3H2kxYkvhJLkywXF8dvXJZCYBp4LHGV4jr' },
  { id: 'five', mint: '5oCpEpFo17kqmcs3454dYFsLGhSNdoPsmSaDRxh5YCzd', label: '5oCp', name: '5oCp hooked mint', decimals: 6,
    pool: '91KiSxVa1mipLotY8HcAwNPULPaSpwXZVM8xyS32t885', counterMint: GGO8_MINT },
  { id: 'dzvf', mint: 'DZVfZHdtS266p4qpTR7vFXxXbrBku18nt9Uxp4KD9bsi', label: 'DZVf', name: 'DZVf hooked mint', decimals: 9,
    pool: 'BD1NZPQ7ezLK3FKnxcaPDkrqsy3CSQbQs4SA8ogAnrWb', counterMint: USDC_MINT },
] as const;

export const HOOKED_MINTS = new Set([
  XEEU_MINT,
  '5oCpEpFo17kqmcs3454dYFsLGhSNdoPsmSaDRxh5YCzd',
  'DZVfZHdtS266p4qpTR7vFXxXbrBku18nt9Uxp4KD9bsi',
]);

export const HOOKED_ORCA_MARKETS = [
  { inputMint: WSOL_MINT, outputMint: XEEU_MINT, pool: XEEU_POOL, hookProgram: THOOOK_HOOK },
] as const;

export function isSupportedHookedOrcaBuy(inputMint: string, outputMint: string, swapMode?: string) {
  if (swapMode === 'ExactOut') return false;
  const market = CONTROLLED_MARKETS.find((market) => market.mint === inputMint || market.mint === outputMint);
  if (!market || (HOOKED_MINTS.has(inputMint) && HOOKED_MINTS.has(outputMint))) return false;
  const counter = inputMint === market.mint ? outputMint : inputMint;
  return counter === WSOL_MINT || counter === market.counterMint || (market.id === 'xeeu' && counter === USDC_MINT);
}

export function assertSupportedHookedRoute(inputMint: string, outputMint: string, swapMode?: string) {
  if ((HOOKED_MINTS.has(inputMint) || HOOKED_MINTS.has(outputMint)) &&
      !isSupportedHookedOrcaBuy(inputMint, outputMint, swapMode)) {
    throw new Error('Choose SOL and one of XEEu, 5oCp, or DZVf for a verified hooked buy/sell route.');
  }
}
