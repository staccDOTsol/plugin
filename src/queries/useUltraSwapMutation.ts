import { useMutation } from '@tanstack/react-query';
import { ISwapContext, QuoteResponse } from 'src/contexts/SwapContext';
import { ultraSwapService } from 'src/data/UltraSwapService';
import { Buffer } from 'buffer';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { useWalletPassThrough } from 'src/contexts/WalletPassthroughProvider';
import { Asset } from 'src/entity/SearchResponse';
import { TransactionError } from 'src/entity/TransactionError';
import { HookedOrcaPrepareResponse, TraderStatusResponse, TraderSubmitResponse, traderJson } from 'src/data/TraderApi';
import { validateCaptainTrade } from 'src/data/ValidateCaptainTransaction';

interface UltraSwapMutationProps {
  fromTokenInfo: Asset;
  toTokenInfo: Asset;
  setTxStatus: (status: ISwapContext['swapping']['txStatus']) => void;
  setLastSwapResult: (result: ISwapContext['lastSwapResult']) => void;
  quoteResponseMeta: QuoteResponse;
}

enum UltraSwapErrorType {
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
  WALLET_SIGNING_FAILED = 'WALLET_SIGNING_FAILED',
}

class UltraSwapError extends Error {
  type: UltraSwapErrorType;
  txid?: string;
  constructor(message: string, type: UltraSwapErrorType, txid?: string) {
    super(message);
    this.type = type;
    this.txid = txid;
  }
}

async function waitForHookedConfirmation(signature: string, receipt: string): Promise<TraderStatusResponse> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    try {
      const status = await traderJson<TraderStatusResponse>(`/api/trader/status/${signature}?receipt=${encodeURIComponent(receipt)}`);
      if (status.err) throw new Error(`Direct trade failed on-chain: ${JSON.stringify(status.err)}`);
      if (status.confirmed) return status;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Direct trade failed')) throw error;
    }
  }
  throw new Error(`Transaction submitted but confirmation is pending. Check Solscan: ${signature}`);
}

async function submitHookedOrcaTrade(
  quoteResponseMeta: QuoteResponse,
  buyer: string,
  signTransaction: NonNullable<ReturnType<typeof useWalletPassThrough>['signTransaction']>,
  setTxStatus: UltraSwapMutationProps['setTxStatus'],
) {
  const quote = quoteResponseMeta.original;
  if (quote.routeKind !== 'hooked-orca' ||
      !/^\d+$/.test(quote.inAmount) || !/^\d+$/.test(quote.otherAmountThreshold)) {
    throw new Error('The selected hooked quote is no longer valid.');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const prepared = await traderJson<HookedOrcaPrepareResponse>('/api/trader/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputMint: quote.inputMint, outputMint: quote.outputMint,
        amount: quote.inAmount, taker: buyer, swapMode: 'ExactIn',
      }),
    });
    if (prepared.routeKind !== 'hooked-orca' || prepared.buyer !== buyer ||
        prepared.inputMint !== quote.inputMint || prepared.outputMint !== quote.outputMint ||
        !['setup', 'swap'].includes(prepared.stage) || !prepared.transaction) {
      throw new Error('Direct trade preparation did not match the connected wallet.');
    }
    if (prepared.stage === 'swap' &&
        (!prepared.minimumOutputRaw || BigInt(prepared.minimumOutputRaw) < BigInt(quote.otherAmountThreshold))) {
      throw new Error('Pool price moved below your displayed minimum. Refresh the quote before signing.');
    }
    const transaction = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, 'base64'));
    validateCaptainTrade(transaction, prepared, buyer, quote.inAmount);
    setTxStatus({ txid: '', status: 'pending-approval' });
    const signed = await signTransaction(transaction);
    setTxStatus({ txid: '', status: 'sending' });
    const submitted = await traderJson<TraderSubmitResponse>('/api/trader/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction: Buffer.from(signed.serialize()).toString('base64'), preparationToken: prepared.preparationToken }),
    });
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(submitted.signature)) {
      throw new Error('Direct trade submission did not return a transaction signature.');
    }
    setTxStatus({ txid: submitted.signature, status: 'sending' });
    const confirmed = await waitForHookedConfirmation(submitted.signature, prepared.preparationToken);
    if (prepared.stage === 'setup') continue;
    return { signature: submitted.signature, status: confirmed };
  }
  throw new Error('Token account setup confirmed, but a fresh swap could not be prepared. Refresh the quote.');
}

export function useUltraSwapMutation() {
  const { wallet, signTransaction } = useWalletPassThrough();
  return useMutation({
    mutationFn: async ({
      setTxStatus,
      setLastSwapResult,
      fromTokenInfo,
      toTokenInfo,
      quoteResponseMeta,
    }: UltraSwapMutationProps) => {
      const publicKey = wallet?.adapter.publicKey;
      if (!signTransaction || !publicKey) {
        throw new UltraSwapError(
          'Wallet not connected, or missing wallet functions',
          UltraSwapErrorType.WALLET_SIGNING_FAILED,
        );
      }

      setTxStatus({
        txid: '',
        status: 'pending-approval',
      });

      const selectedQuote = quoteResponseMeta.original;

      if (selectedQuote.routeKind === 'hooked-orca') {
        const { signature, status } = await submitHookedOrcaTrade(
          quoteResponseMeta, publicKey.toBase58(), signTransaction, setTxStatus,
        );
        const actualInput = status.inputAmountResult && /^\d+$/.test(status.inputAmountResult)
          ? status.inputAmountResult : selectedQuote.inAmount;
        const actualOutput = status.outputAmountResult && /^\d+$/.test(status.outputAmountResult)
          ? status.outputAmountResult : selectedQuote.outAmount;
        setTxStatus({ txid: signature, status: 'success' });
        setLastSwapResult({
          swapResult: {
            txid: signature,
            inputAddress: new PublicKey(fromTokenInfo.id),
            outputAddress: new PublicKey(toTokenInfo.id),
            inputAmount: Number(actualInput),
            outputAmount: Number(actualOutput),
            amountsEstimated: !status.outputAmountResult,
          },
          quoteReponse: quoteResponseMeta,
        });
        return signature;
      }

      const { transaction, requestId } = selectedQuote;

      if (!transaction) throw new Error('Missing transaction');
      const based64tx = Buffer.from(transaction, 'base64');

      const versionedTransaction = VersionedTransaction.deserialize(new Uint8Array(based64tx));

      const signedTransaction = await signTransaction(versionedTransaction);
      const serializedTransaction = Buffer.from(signedTransaction.serialize()).toString('base64');

      setTxStatus({
        txid: '',
        status: 'sending',
      });

      const response = await ultraSwapService.submitSwap(serializedTransaction, requestId);

      const { signature, status } = response;

      if (status === 'Failed') {
        throw new UltraSwapError(response.error, UltraSwapErrorType.FAILED, signature);
      }

      const { inputAmountResult, outputAmountResult } = response;

      setTxStatus({
        txid: signature,
        status: 'success',
      });
      setLastSwapResult({
        swapResult: {
          txid: signature,
          inputAddress: new PublicKey(fromTokenInfo.id),
          outputAddress: new PublicKey(toTokenInfo.id),
          inputAmount: Number(inputAmountResult),
          outputAmount: Number(outputAmountResult),
        },
        quoteReponse: quoteResponseMeta,
      });
      return signature;
    },
    onError: async (error, variables) => {
      const { setTxStatus, setLastSwapResult, quoteResponseMeta } = variables;
      setTxStatus({ txid: '', status: 'fail' });
      const {name} = error as any;

      if (name === 'WalletSignTransactionError') {
        const message = 'Transaction cancelled';
        setLastSwapResult({
          swapResult: {
            error: new TransactionError(message),
          },
          quoteReponse: quoteResponseMeta,
        });
        return;
      }

      if (error instanceof Error) {
        setLastSwapResult({
          swapResult: {
            error: new TransactionError(error.message),
          },
          quoteReponse: quoteResponseMeta,
        });
        return;
      }

      if (typeof error === 'object' && error !== null && 'json' in error) {
        const json = (await (error as any).json()) as {
          txid: string;
          signature: string;
          error: string;
          status: string;
        };

        setLastSwapResult({
          swapResult: {
            error: new TransactionError(json.error || 'Unknown error'),
          },
          quoteReponse: quoteResponseMeta,
        });

        setTxStatus({
          txid: json.txid || '',
          status: 'fail',
        });
        return;
      }
      setLastSwapResult({
        swapResult: {
          error: new TransactionError( 'Unknown error'),
        },
        quoteReponse: quoteResponseMeta,
      });
    },
  });
}
