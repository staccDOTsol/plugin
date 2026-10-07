import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { CONTROLLED_MARKETS, CONTROLLER, GGO8_MINT, ORCA_PROGRAM, RAYDIUM_PROGRAM, SOL_GGO8_POOL, SOL_USDC_POOL, THOOOK_HOOK, USDC_MINT, WSOL_MINT } from './HookedOrcaRoutes';
import { AuctionPreparation, HookedOrcaPrepareResponse, LiquidityPreparation } from './TraderApi';

const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM = '11111111111111111111111111111111';
const BUDGET = 'ComputeBudget111111111111111111111111111111';
const SWAP = '2b04ed0b1ac91e62', TWO_HOP = 'ba8fd11dfe02c275';
const CP_IN = '8fbe5adac41e33de', CP_OUT = '37d96256a34ab4ad';
const hex = (bytes: Uint8Array) => Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
const pda = (seed: string, mint: string, program: string) => PublicKey.findProgramAddressSync([
  new TextEncoder().encode(seed), new PublicKey(mint).toBuffer(),
], new PublicKey(program))[0].toBase58();
const tokenProgram = (mint: string) => mint === WSOL_MINT || mint === USDC_MINT ? TOKEN : TOKEN22;
const associated = (buyer: string, mint: string) => PublicKey.findProgramAddressSync([
  new PublicKey(buyer).toBuffer(), new PublicKey(tokenProgram(mint)).toBuffer(), new PublicKey(mint).toBuffer(),
], new PublicKey(ATA))[0].toBase58();

function decoded(tx: VersionedTransaction, buyer: string) {
  const message = tx.message;
  if (!('addressTableLookups' in message) || message.addressTableLookups.length || message.staticAccountKeys[0]?.toBase58() !== buyer) {
    throw new Error('The prepared packet must use the connected buyer and no unverified lookup tables.');
  }
  return message.compiledInstructions.map((ix) => ({
    program: message.staticAccountKeys[ix.programIdIndex].toBase58(),
    accounts: ix.accountKeyIndexes.map((index) => message.staticAccountKeys[index].toBase58()),
    bytes: ix.data, view: new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength),
  }));
}

function isBudget(ix: ReturnType<typeof decoded>[number]) {
  if (ix.program !== BUDGET) return false;
  if (ix.bytes.length !== 5 || ![1, 2].includes(ix.bytes[0])) throw new Error('Unexpected compute-budget instruction.');
  const value = ix.view.getUint32(1, true);
  if ((ix.bytes[0] === 1 && value > 262144) || (ix.bytes[0] === 2 && value > 1400000)) throw new Error('Unexpected compute budget.');
  return true;
}

export function validateCaptainTrade(tx: VersionedTransaction, prepared: HookedOrcaPrepareResponse, buyer: string, amount: string) {
  const market = CONTROLLED_MARKETS.find((market) => market.mint === prepared.marketMint);
  if (!market || prepared.chain !== 'mainnet-beta' || prepared.buyer !== buyer || prepared.inputRaw !== amount ||
      tx.message.header.numRequiredSignatures !== 1 || prepared.slippageBps !== 100 ||
      !prepared.preparationToken || !/^\d+$/.test(prepared.minimumOutputRaw)) throw new Error('The preparation differs from the selected mainnet wallet and trade.');
  const addresses = prepared.accounts;
  for (const [mint, address] of Object.entries(addresses)) if (address !== associated(buyer, mint)) throw new Error('A wallet token account changed.');
  const instructions = decoded(tx, buyer).filter((ix) => !isBudget(ix));
  if (prepared.stage === 'setup') {
    for (const ix of instructions) {
      if (ix.program === ATA && ix.bytes.length === 1 && ix.bytes[0] === 1 && ix.accounts[0] === buyer && ix.accounts[2] === buyer &&
          ix.accounts[1] === associated(buyer, ix.accounts[3]) && ix.accounts[5] === tokenProgram(ix.accounts[3])) continue;
      const move = prepared.sourceTransfers?.find((move) => move.source === ix.accounts[0]);
      if (ix.program === TOKEN22 && ix.bytes.length === 10 && ix.bytes[0] === 12 && move &&
          ix.view.getBigUint64(1, true) === BigInt(move.amountRaw) && ix.accounts[1] === market.mint &&
          ix.accounts[2] === associated(buyer, market.mint) && ix.accounts[3] === buyer) continue;
      throw new Error('Unexpected action in the wallet-account setup.');
    }
    return;
  }
  const allowedPools = new Set<string>([market.pool, SOL_USDC_POOL, SOL_GGO8_POOL,
    ...('usdcPool' in market ? [market.usdcPool] : [])]);
  if (prepared.pools.some((pool) => !allowedPools.has(pool))) throw new Error('The route uses an unrecognized market.');
  const swapInstructions = instructions.filter((ix) => ix.program === ORCA_PROGRAM || ix.program === RAYDIUM_PROGRAM);
  if (!swapInstructions.length || swapInstructions.length > 2) throw new Error('Unexpected route length.');
  const expectedPools = prepared.pools;
  const native = prepared.inputMint === WSOL_MINT || prepared.outputMint === WSOL_MINT;
  const buying = prepared.outputMint === market.mint;
  const directPool = market.id === 'xeeu' && !native && 'usdcPool' in market ? market.usdcPool : market.pool;
  const path = expectedPools.length === 1 ? [directPool] : market.id === 'five'
    ? [SOL_GGO8_POOL, market.pool] : [SOL_USDC_POOL, market.id === 'xeeu' && 'usdcPool' in market ? market.usdcPool : market.pool];
  const oriented = buying ? path : [...path].reverse();
  if (expectedPools.join(',') !== oriented.join(',')) throw new Error('The pool path is not a registered route.');
  const hasBridge = expectedPools.includes(SOL_GGO8_POOL);
  if (expectedPools.length === 1 && swapInstructions.length !== 1 || expectedPools.length === 2 &&
      (hasBridge ? swapInstructions.length !== 2 : swapInstructions.length !== 1)) throw new Error('The route instruction count changed.');
  const marketEaml = pda('extra-account-metas', market.mint, prepared.hookProgram);
  let inputBound = false, outputBound = false, hookIncluded = false;
  let maximumInput = BigInt(0), swapIndex = 0;
  const bridgeAmounts: bigint[] = [];
  for (const ix of instructions) {
    if (ix.program === SYSTEM) {
      if (ix.bytes.length !== 12 || ix.view.getUint32(0, true) !== 2 || ix.accounts[0] !== buyer ||
          ix.accounts[1] !== addresses[WSOL_MINT] || prepared.inputMint !== WSOL_MINT ||
          ix.view.getBigUint64(4, true) > BigInt(amount)) throw new Error('An unexpected SOL debit was added.');
      continue;
    }
    if (ix.program === TOKEN) {
      if (ix.bytes.length === 1 && ix.bytes[0] === 17 && ix.accounts[0] === addresses[WSOL_MINT]) continue;
      if (ix.bytes.length === 1 && ix.bytes[0] === 9 && ix.accounts[0] === addresses[WSOL_MINT] &&
          ix.accounts[1] === buyer && ix.accounts[2] === buyer) continue;
      throw new Error('An unexpected token instruction was added.');
    }
    const discriminator = hex(ix.bytes.slice(0, 8));
    if (ix.program === ORCA_PROGRAM && discriminator === SWAP && ix.bytes.length >= 42) {
      if (ix.accounts[4] !== expectedPools[swapIndex++] || ix.accounts[3] !== buyer) throw new Error('The Whirlpool or signer changed.');
      const inputMint = ix.bytes[41] ? ix.accounts[5] : ix.accounts[6];
      const outputMint = ix.bytes[41] ? ix.accounts[6] : ix.accounts[5];
      const source = ix.bytes[41] ? ix.accounts[7] : ix.accounts[9];
      const destination = ix.bytes[41] ? ix.accounts[9] : ix.accounts[7];
      if (source !== addresses[inputMint] || destination !== addresses[outputMint]) throw new Error('A swap redirects wallet tokens.');
      const specified = ix.view.getBigUint64(8, true), threshold = ix.view.getBigUint64(16, true);
      if (inputMint === prepared.inputMint) { maximumInput += ix.bytes[40] ? specified : threshold; inputBound ||= ix.bytes[40] ? specified === BigInt(amount) : threshold === BigInt(amount); }
      else if (!hasBridge || inputMint !== GGO8_MINT) throw new Error('An unrelated wallet asset is being spent.');
      if (outputMint === prepared.outputMint) outputBound ||= ix.bytes[40] ? threshold >= BigInt(prepared.minimumOutputRaw) : specified >= BigInt(prepared.minimumOutputRaw);
      if (hasBridge) bridgeAmounts.push(specified);
      hookIncluded ||= ix.accounts.includes(prepared.hookProgram) && ix.accounts.includes(marketEaml);
      continue;
    }
    if (ix.program === ORCA_PROGRAM && discriminator === TWO_HOP && ix.bytes.length >= 59) {
      if (ix.accounts[0] !== expectedPools[0] || ix.accounts[1] !== expectedPools[1] || ix.accounts[14] !== buyer ||
          ix.accounts[2] !== prepared.inputMint || ix.accounts[4] !== prepared.outputMint ||
          ix.accounts[8] !== addresses[prepared.inputMint] || ix.accounts[13] !== addresses[prepared.outputMint] || ix.bytes[24] !== 1 ||
          ix.view.getBigUint64(8, true) !== BigInt(amount) || ix.view.getBigUint64(16, true) < BigInt(prepared.minimumOutputRaw)) {
        throw new Error('The two-hop route differs from the approved input, output, or wallet.');
      }
      inputBound = true; outputBound = true;
      maximumInput += ix.view.getBigUint64(8, true);
      hookIncluded ||= ix.accounts.includes(prepared.hookProgram) && ix.accounts.includes(marketEaml);
      continue;
    }
    if (ix.program === RAYDIUM_PROGRAM && [CP_IN, CP_OUT].includes(discriminator) && ix.bytes.length === 24) {
      if (ix.accounts[0] !== buyer || ix.accounts[3] !== expectedPools[swapIndex++] || ix.accounts[3] !== SOL_GGO8_POOL ||
          ix.accounts[4] !== addresses[ix.accounts[10]] || ix.accounts[5] !== addresses[ix.accounts[11]] ||
          ![WSOL_MINT, GGO8_MINT].includes(ix.accounts[10]) || ![WSOL_MINT, GGO8_MINT].includes(ix.accounts[11])) throw new Error('The bridge redirects wallet tokens.');
      if (ix.accounts[10] === prepared.inputMint) { maximumInput += ix.view.getBigUint64(8, true); inputBound ||= ix.view.getBigUint64(8, true) === BigInt(amount); }
      else if (!hasBridge || ix.accounts[10] !== GGO8_MINT) throw new Error('An unrelated wallet asset is being spent.');
      if (ix.accounts[11] === prepared.outputMint) outputBound ||= ix.view.getBigUint64(16, true) >= BigInt(prepared.minimumOutputRaw);
      bridgeAmounts.push(ix.view.getBigUint64(discriminator === CP_OUT ? 16 : 8, true));
      continue;
    }
    throw new Error('The prepared trade contains an unrecognized instruction.');
  }
  if (!inputBound || !outputBound || !hookIncluded || maximumInput !== BigInt(amount) ||
      hasBridge && (bridgeAmounts.length !== 2 || bridgeAmounts[0] !== bridgeAmounts[1])) throw new Error('The input cap, bridge amount, minimum output, or hook accounts differ from the approved route.');
}

const ORCA_IX: Record<string, { whirlpoolIndex: number | null; configIndex?: number }> = {
  // Anchor discriminators (sha256("global:<name>")[0..8]) for the only Whirlpool instructions a liquidity step may contain.
  b74a9ca070022a1e: { whirlpoolIndex: null, configIndex: 0 },   // initialize_fee_tier
  fd4dcd5f1be059df: { whirlpoolIndex: null, configIndex: 0 },   // initialize_token_badge
  cf2d57f21b3fcc43: { whirlpoolIndex: 6, configIndex: 0 },      // initialize_pool_v2
  '0bbcc1d68d5b95b8': { whirlpoolIndex: 0 },                     // initialize_tick_array
  d42f5f5c726683fa: { whirlpoolIndex: 5 },                      // open_position_with_token_extensions
  '851d59df45eeb00a': { whirlpoolIndex: 0 },                     // increase_liquidity_v2
  '3a7fbc3e4f52c460': { whirlpoolIndex: 0 },                     // decrease_liquidity_v2
  cf755fbfe5b4e20f: { whirlpoolIndex: 0 },                      // collect_fees_v2
  '9ae6fa0decd14bdf': { whirlpoolIndex: 0 },                     // update_fees_and_rewards
  '01b6873b9b1963df': { whirlpoolIndex: null },                  // close_position_with_token_extensions
};
const WSOL_ATA = (owner: string) => PublicKey.findProgramAddressSync([
  new PublicKey(owner).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(WSOL_MINT).toBuffer(),
], new PublicKey(ATA))[0].toBase58();

export function validateCaptainBid(tx: VersionedTransaction, prepared: AuctionPreparation, buyer: string) {
  const market = CONTROLLED_MARKETS.find((market) => market.mint === prepared.mint);
  if (!market || prepared.chain !== 'mainnet-beta' || prepared.buyer !== buyer || prepared.paymentRecipient !== CONTROLLER ||
      prepared.retainedAuthority !== CONTROLLER || prepared.stage !== 'bid' || !/^\d+$/.test(prepared.bidLamports) ||
      tx.message.header.numRequiredSignatures !== 1) throw new Error('Bid preparation differs from the selected wallet or auction terms.');
  const instructions = decoded(tx, buyer).filter((ix) => !isBudget(ix));
  const bid = instructions[0];
  if (instructions.length !== 1 || !bid || bid.program !== THOOOK_HOOK || bid.bytes.length !== 49 || bid.bytes[0] !== 7 ||
      bid.view.getBigUint64(1, true) !== BigInt(prepared.round) || bid.view.getBigUint64(9, true) !== BigInt(prepared.bidLamports) ||
      new PublicKey(bid.bytes.slice(17, 49)).toBase58() !== prepared.programId) throw new Error('The bid amount, round, or proposed hook changed.');
  const expected = [buyer, market.mint, pda('config', market.mint, THOOOK_HOOK), pda('auction', market.mint, THOOOK_HOOK), prepared.previousBidder,
    prepared.programId, pda('extra-account-metas', market.mint, prepared.programId), SYSTEM, prepared.holding];
  if (bid.accounts.join(',') !== expected.join(',')) throw new Error('The bid accounts differ from the live auction. Refresh.');
}

export function validateCaptainLiquidity(tx: VersionedTransaction, prepared: LiquidityPreparation, wallet: string) {
  if (prepared.chain !== 'mainnet-beta' || prepared.engine !== 'liquidity' || prepared.wallet !== wallet ||
      tx.message.header.numRequiredSignatures !== 1 + prepared.ephemeralSigners.length) throw new Error('Liquidity preparation differs from the connected wallet.');
  const message = tx.message;
  const allowedSigners = new Set([wallet, ...prepared.ephemeralSigners]);
  message.staticAccountKeys.forEach((key, index) => {
    if (message.isAccountSigner(index) && !allowedSigners.has(key.toBase58())) throw new Error('An unexpected signer was added to this step.');
  });
  const wsol = WSOL_ATA(wallet);
  let orcaCount = 0;
  for (const ix of decoded(tx, wallet).filter((ix) => !isBudget(ix))) {
    if (ix.program === ORCA_PROGRAM) {
      const kind = ORCA_IX[hex(ix.bytes.slice(0, 8))];
      if (!kind) throw new Error('This step contains a Whirlpool instruction the wizard does not use.');
      if (kind.whirlpoolIndex != null && prepared.pool && ix.accounts[kind.whirlpoolIndex] !== prepared.pool) throw new Error('A Whirlpool instruction targets a different pool.');
      if (kind.configIndex != null && prepared.config && ix.accounts[kind.configIndex] !== prepared.config) throw new Error('A Whirlpool instruction targets a different config.');
      orcaCount += 1; continue;
    }
    if (ix.program === SYSTEM) {
      if (ix.bytes.length !== 12 || ix.view.getUint32(0, true) !== 2 || ix.accounts[0] !== wallet || ix.accounts[1] !== wsol) throw new Error('An unexpected SOL transfer was added.');
      continue;
    }
    if (ix.program === ATA) {
      if (ix.bytes.length !== 1 || ix.bytes[0] !== 1 || ix.accounts[0] !== wallet || ix.accounts[2] !== wallet) throw new Error('An unexpected token-account creation was added.');
      continue;
    }
    if (ix.program === TOKEN) {
      if (ix.bytes.length === 1 && ix.bytes[0] === 17 && ix.accounts[0] === wsol) continue;
      if (ix.bytes.length === 1 && ix.bytes[0] === 9 && ix.accounts[0] === wsol && ix.accounts[1] === wallet && ix.accounts[2] === wallet) continue;
      throw new Error('An unexpected token instruction was added.');
    }
    throw new Error('This step contains an instruction from an unrecognized program.');
  }
  if (!orcaCount) throw new Error('This step contains no Whirlpool instruction.');
}
