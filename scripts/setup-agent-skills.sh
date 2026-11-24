#!/usr/bin/env bash
# Descarga oficial de las 9 skills usadas por Bolt Pets.
# Ejecutar MANUALMENTE desde la raiz del proyecto tras revisar las fuentes.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null || ! command -v npx >/dev/null; then
  echo "Necesitas Node.js >= 22.20 y npx en PATH" >&2
  exit 1
fi
export DISABLE_TELEMETRY=1
echo "Instalando habilidades de Bolt Pets para Google Antigravity..."
npx -y skills@latest add vercel-labs/agent-skills --skill vercel-react-best-practices --skill web-design-guidelines --agent antigravity --copy -y
npx -y skills@latest add supabase/agent-skills --skill supabase --skill supabase-postgres-best-practices --agent antigravity --copy -y
npx -y skills@latest add Shopify/shopify-ai-toolkit --skill shopify --agent antigravity --copy -y
npx -y skills@latest add microsoft/playwright-cli --skill playwright-cli --agent antigravity --copy -y
npx -y skills@latest add mattpocock/skills --skill tdd --skill diagnosing-bugs --agent antigravity --copy -y
npx -y skills@latest add expo/skills --skill expo-web-to-native --agent antigravity --copy -y
echo "Habilidades instaladas:"
npx -y skills@latest list --agent antigravity
