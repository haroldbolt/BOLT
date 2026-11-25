import { useState } from 'react';
import { OrderConfirmation, type ConfirmationOrder } from './OrderConfirmation';
import { OrderTracking } from './OrderTracking';

interface Props {
  orderId: string;
  onContinue: () => void;
}

export function OrderConfirmationPage({ orderId, onContinue }: Props) {
  const [summary, setSummary] = useState<ConfirmationOrder | null>(null);

  if (summary) {
    return <OrderConfirmation order={summary} onTrack={() => setSummary(null)} onContinue={onContinue} />;
  }
  return <OrderTracking orderId={orderId} guestOnly onBack={onContinue} onViewSummary={setSummary} />;
}
