import { Asset } from 'src/entity/SearchResponse';
import { CONTROLLED_MARKETS, GGO8_MINT } from './HookedOrcaRoutes';

// Chain-known mint metadata only. Analytics, verification, and USD prices are
// not fabricated for mints absent from Jupiter's indexed token list.
export const CONTROLLED_ASSETS = [
  ...CONTROLLED_MARKETS.map((market) => ({ id: market.mint, name: market.name, symbol: market.label,
    decimals: market.decimals, tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    icon: 'https://api.captainhook.fun/assets/captain-hook.svg' })),
  { id: GGO8_MINT, name: 'GGo8', symbol: 'GGo8', decimals: 6,
    tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
] as Asset[];
