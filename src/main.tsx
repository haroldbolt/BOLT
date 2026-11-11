import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import {CustomerProvider} from './customer/client';
import {AccountPage,LegalPage} from './customer/AccountPages';
import type {LegalKind} from './customer/legal';
import './index.css';

// Google Maps Platform Quota Defense & Global Listener
(window as any).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};
const origError = console.error;
console.error = (...args: unknown[]) => {
  origError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

const path=window.location.pathname;
const legalKind=path==='/eliminar-cuenta'?'eliminacion':path.startsWith('/legal/')?path.split('/')[2]:null;
const validLegal=['terminos','privacidad','eliminacion'].includes(legalKind||'');
createRoot(document.getElementById('root')!).render(<CustomerProvider>{validLegal?<LegalPage kind={legalKind as LegalKind}/>:path==='/cuenta'?<AccountPage/>:<App/>}</CustomerProvider>);
