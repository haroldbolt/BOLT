import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

const serverVariables = [
  'BOLT_ADMIN_PASSWORD', 'BOLT_ADMIN_SETUP_TOKEN', 'BOLT_APPLE_CLIENT_SECRET',
  'BOLT_CUSTOMER_BOOTSTRAP_DATABASE_URL', 'BOLT_CUSTOMER_DATABASE_URL', 'BOLT_CUSTOMER_SECRET',
  'BOLT_DEMO_PASSWORD', 'BOLT_GOOGLE_CLIENT_SECRET', 'BOLT_PHOTO_SEARCH_OPENAI_API_KEY',
  'BOLT_RESEND_API_KEY', 'BOLT_SMTP_PASSWORD', 'BOLT_WOMPI_PRIVATE_KEY',
  'GOOGLE_MAPS_SERVER_API_KEY', 'OPENAI_API_KEY', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_CLIENT_SECRET',
];
const privateArtifact = /^(?:\.env(?:\..*)?|\.git|\.bolt-private|\.bolt-storage|private-entrance-photos|persisted-.*\.json|server\.(?:ts|js)|.*\.(?:map|p8|p12|pfx|key))$/i;
const publicSecretName = /(?:^|_)(?:PASSWORD|SECRET|PRIVATE_KEY|ACCESS_TOKEN|SETUP_TOKEN|API_KEY|DATABASE_URL)(?:_|$)/;
const privateMaterial = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\\nr]+[a-zA-Z0-9+/=]{32,}|\b(?:shpat_[a-f0-9]{32,}|sk-(?:proj-|svcacct-)[a-zA-Z0-9_-]{30,}|re_[a-zA-Z0-9]{8}_[a-zA-Z0-9]{24,})\b/;
const sourceMapDirective = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/;

export function assertPublicBuild(directory, env) {
  for (const name of Object.keys(env)) {
    if (name.startsWith('VITE_') && name !== 'VITE_GOOGLE_MAPS_API_KEY' && publicSecretName.test(name)) {
      throw new Error('Variable de credencial con prefijo público VITE_.');
    }
  }
  // High confidence matches. Never display the value, a snippet, or file contents.
  const knownValues = serverVariables.map(name => env[name]).filter(value => typeof value === 'string' && value.length >= 10);
  function inspect(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (privateArtifact.test(entry.name) || entry.isSymbolicLink()) throw new Error('Archivo interno, mapa de fuentes o enlace en dist.');
      if (entry.isDirectory()) {
        inspect(file);
        continue;
      }
      if (!entry.isFile()) throw new Error('Tipo de archivo inesperado en dist.');
      const bytes = fs.readFileSync(file);
      if (knownValues.some(value => bytes.includes(value))) throw new Error('Valor de una credencial del servidor en dist.');
      if (/\.(?:js|mjs|cjs|css|json|html|txt|svg|xml|webmanifest)$/i.test(entry.name)) {
        const content = bytes.toString('utf8');
        if (sourceMapDirective.test(content)) throw new Error('Referencia a mapa de fuentes público.');
        if (privateMaterial.test(content)) throw new Error('Formato reconocible de clave privada en dist.');
      }
    }
  }
  if (!fs.statSync(path.join(directory, 'index.html')).isFile()) throw new Error('Falta la entrada web compilada.');
  inspect(directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assertPublicBuild(path.resolve('dist'), loadEnv('production', process.cwd(), ''));
  console.log('Distribución web revisada.');
}
