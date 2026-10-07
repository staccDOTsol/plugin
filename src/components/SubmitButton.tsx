import { cn } from 'src/misc/cn';
import JupButton from './JupButton';
import { useMemo } from 'react';
import { useSwapContext } from 'src/contexts/SwapContext';

interface SubmitButtonProps {
  onSubmit: VoidFunction;
}

export const SubmitButton = ({ onSubmit }: SubmitButtonProps) => {
  const {
    quoteResponseMeta,
    loading,
    errors,
    swapping: { txStatus },
    form
  } = useSwapContext();
  const shouldButtonDisabled = useMemo(() => {
    if (
      !quoteResponseMeta ||
      loading ||
      !!errors.fromValue ||
      txStatus?.status === 'loading' ||
      txStatus?.status === 'sending' ||
      txStatus?.status === 'pending-approval'
    ) {
      return true;
    }
    return false;
  }, [quoteResponseMeta, loading, errors.fromValue, txStatus]);

  const buttonText = useMemo(() => {
    if (errors.fromValue) return errors.fromValue.title;
    if (quoteResponseMeta?.quoteResponse?.errorMessage) return quoteResponseMeta.quoteResponse.errorMessage;        
    if (loading) return 'Loading';
    if (txStatus?.status === 'sending') return 'Sending';
    if (txStatus?.status === 'pending-approval') return 'Pending Approval';
    return quoteResponseMeta?.original.routeKind === 'hooked-orca' ? 'Review & sign trade' : 'Swap via Jupiter Ultra';
  }, [txStatus, errors.fromValue, loading,quoteResponseMeta]);

  return (
    <><JupButton
      size="lg"
      className={cn('w-full mt-4 disabled:opacity-50 !text-uiv2-text/75 !bg-primary ')}
      onClick={onSubmit}
      disabled={shouldButtonDisabled}
    >
      <span>{buttonText}</span>
    </JupButton>
    {errors.fromValue?.message && <p role="alert" className="mt-3 text-xs leading-5 text-warning break-words">{errors.fromValue.message}</p>}
    </>
  );
};
