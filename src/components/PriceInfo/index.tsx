import Decimal from 'decimal.js';
import { useMemo } from 'react';
import { formatNumber, formatUiAmount } from 'src/misc/utils';
import ExchangeRate from '../ExchangeRate';
import TransactionFee from './TransactionFee';
import { QuoteResponse } from 'src/contexts/SwapContext';
import { cn } from 'src/misc/cn';
import { Asset } from 'src/entity/SearchResponse';

const Index = ({
  quoteResponse,
  fromTokenInfo,
  toTokenInfo,
  loading,
  containerClassName,
}: {
  quoteResponse: QuoteResponse;
  fromTokenInfo: Asset;
  toTokenInfo: Asset;
  loading: boolean;
  containerClassName?: string;
}) => {
  const rateParams = {
    inAmount: quoteResponse?.quoteResponse.inAmount || BigInt(0), // If there's no selectedRoute, we will use first route value to temporarily calculate
    inputAsset: fromTokenInfo,
    outAmount: quoteResponse?.quoteResponse.outAmount || BigInt(0), // If there's no selectedRoute, we will use first route value to temporarily calculate
    outputAsset: toTokenInfo,
  };

  const priceImpact = formatNumber.format(
    new Decimal(quoteResponse?.quoteResponse.priceImpactPct || 0).mul(100).toDP(2),
  );

  const priceImpactText = Number(priceImpact) < 0.01 ? undefined : `-${priceImpact}%`;
  const directHookRoute = quoteResponse.original.routeKind === 'hooked-orca';
  const minimumOutput = quoteResponse.quoteResponse.otherAmountThreshold;
  const fee = useMemo(() => {
    if (!quoteResponse) {
      return 0;
    }
    return quoteResponse.quoteResponse.platformFee.feeBps / 100;
  }, [quoteResponse]);


  const gasFee = useMemo(() => {
    if (quoteResponse) {
      const { prioritizationFeeLamports, signatureFeeLamports } = quoteResponse.quoteResponse;
      let totalFeeLamports = 0;
      if (prioritizationFeeLamports) {
        totalFeeLamports += prioritizationFeeLamports;
      }
      if (signatureFeeLamports) {
        totalFeeLamports += signatureFeeLamports;
      }
      return totalFeeLamports / 1e9; // Convert lamports to SOL
    }
    return 0;
  }, [quoteResponse]);

  return (
    <div className={cn('mt-4 space-y-4 ', containerClassName)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-primary-text/50">Route</span>
        <span className="text-primary-text text-right">
          {directHookRoute ? quoteResponse.original.routePlan.map((step) => step.swapInfo.label).join(' → ') : 'Jupiter Ultra'}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="text-primary-text/50">{<span>Rate</span>}</div>
        {rateParams.inAmount > BigInt(0) &&
        rateParams.outAmount > BigInt(0) ? (
          <ExchangeRate
            loading={loading}
            rateParams={rateParams}
            fromTokenInfo={fromTokenInfo}
            toTokenInfo={toTokenInfo}
            reversible={true}
          />
        ) : (
          <span className="text-primary-text/50">{'-'}</span>
        )}
      </div>

      {priceImpactText && (
        <div className="flex items-center justify-between text-xs text-primary-text/50">
          <div>
            <span>Price Impact</span>
          </div>
          <div className="text-primary-text">{priceImpactText}</div>
        </div>
      )}

      {minimumOutput > BigInt(0) && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-primary-text/50">Minimum receive</span>
          <span className="text-primary-text text-right">
            {formatUiAmount(minimumOutput, toTokenInfo)} {toTokenInfo.symbol}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <div className="text-primary-text/50">
          <span>Platform Fee</span>
        </div>
        <div className="text-primary-text">{fee}%</div>
      </div>
      <TransactionFee gasFee={gasFee} gasless={quoteResponse?.quoteResponse.gasless} />
      {directHookRoute && (
        <p className="text-[11px] leading-4 text-primary-text/50">
          {quoteResponse.original.simulation?.passed ? quoteResponse.original.simulation.stage === 'swap'
            ? 'Complete trade passed mainnet simulation for this wallet.' : 'Account setup passed simulation. The full swap is checked after setup.'
            : 'Connect a holder wallet to verify eligibility and simulate the complete trade.'}
          {quoteResponse.original.amountMode === 'max' && ' Input is a maximum; unused input stays in your wallet.'}
        </p>
      )}
    </div>
  );
};

export default Index;
