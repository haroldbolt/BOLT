import { readFileSync } from 'node:fs';

const pointId = process.argv[2];
if (pointId && !/^[1-9]\d{0,14}$/.test(pointId)) throw Error('Identificador numérico del punto inválido.');
const token = (process.env.BOLT_RAPPI_CARGO_SANDBOX_TOKEN ?? (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'))).trim();
if (!token || /\s/.test(token)) throw Error('Falta el token del sandbox de Cargo.');

const endpoint = pointId ? '/picking-point/view/' + pointId : '/picking-point/list?offset=0&limit=50';
try {
  const response = await fetch('https://microservices.dev.rappi.com/api/cargo-api-gateway' + endpoint, {
    headers: { 'user-token': token, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  // The response may contain addresses and contacts. Do not log or save it.
  await response.body?.cancel();
  console.log('Rappi Cargo sandbox (GET): HTTP', response.status);
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('No se pudo conectar al sandbox de Rappi Cargo.');
  process.exitCode = 1;
}
