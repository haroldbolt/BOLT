# Skills de programación para Bolt Pets

Este proyecto tiene **nueve habilidades de agente** en `.agents/skills/`, detectables por **Google Antigravity** y otros agentes compatibles con Agent Skills. Se instalaron en una rama de revisión, no en la rama principal ni globalmente en ChatGPT.

| Skill | Fuente oficial | Uso en Bolt Pets |
| --- | --- | --- |
| vercel-react-best-practices | https://github.com/vercel-labs/agent-skills | React 19, rendimiento, manejo de datos |
| web-design-guidelines | https://github.com/vercel-labs/agent-skills | Accesibilidad y experiencia móvil |
| supabase | https://github.com/supabase/agent-skills | Persistencia, Auth, almacenamiento |
| supabase-postgres-best-practices | https://github.com/supabase/agent-skills | SQL, permisos RLS, reservas de inventario |
| shopify | https://github.com/Shopify/shopify-ai-toolkit | Shopify Admin API, inventario por sede |
| playwright-cli | https://github.com/microsoft/playwright-cli | Automatización y pruebas de compra |
| tdd | https://github.com/mattpocock/skills | Pruebas y desarrollo por comportamiento |
| diagnosing-bugs | https://github.com/mattpocock/skills | Diagnóstico de errores |
| expo-web-to-native | https://github.com/expo/skills | Migración web a Android/iOS |

## Instalación y estado

Se incluyeron los `SKILL.md` de las nueve skills y las referencias textuales de React, Supabase, PostgreSQL, TDD, debugging, Playwright, Expo y Shopify. Los **93 archivos comprimidos `.br` del AI Toolkit de Shopify no se pudieron copiar** por los límites de transferencia de archivos binarios del conector; son necesarios para algunas validaciones y búsquedas locales de Shopify. **Para restaurar los archivos completos de las nueve skills desde las fuentes originales**, ejecutar la instalación oficial del gestor `skills` desde el proyecto:

```bash
bash scripts/setup-agent-skills.sh
```

Este comando requiere Node.js **22.20 o posterior**, `npx` y acceso a Internet. Descarga archivos desde sus repositorios oficiales; revisa previamente el script, las fuentes y los permisos concedidos al agente. No se ha ejecutado ese comando sobre tu computadora o Google Antigravity.

## Uso en Google Antigravity

1. Fusiona la solicitud de incorporación en `main` después de revisar los archivos; o abre directamente la rama de la propuesta.
2. Abre BOLT como proyecto en Google Antigravity.
3. Ve al panel Customizations / Skills o inicia una conversación nueva. Invoca `/vercel-react-best-practices`, `/supabase`, `/shopify`, etc. cuando corresponda.

Las skills son instrucciones y recursos. Por sí solas no aprovisionan PostgreSQL, conectan Shopify ni ejecutan pruebas de producción.

## Seguridad

- El código original de Bolt Pets no se modifica por esta rama: solo agrega `.agents/skills/` y un instalador opcional en `scripts/`.
- Las herramientas de terceros incluyen scripts ejecutables que deben inspeccionarse antes de usarse. Shopify AI Toolkit incluye un hook de telemetría en su manifiesto; revisar antes de permitir que se ejecute.
- No incorporar secretos a los prompts ni otorgar permisos de escritura de Shopify sin revisión. No ejecutar el instalador ni instalar dependencias automáticamente sin una decisión humana.
- Licencias upstream incluidas bajo `.agents/skills/UPSTREAM_LICENSES/` cuando están disponibles.
