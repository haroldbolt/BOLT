# Skills de programación de Bolt Pets

Paquete de nueve skills para **Google Antigravity** y agentes compatibles. Son instrucciones y recursos, no nuevas dependencias de Node.js ni instalación global de ChatGPT.

| Skill | Proyecto fuente | Fin |
| --- | --- | --- |
| vercel-react-best-practices | https://github.com/vercel-labs/agent-skills | Rendimiento React |
| web-design-guidelines | https://github.com/vercel-labs/agent-skills | Auditoría UI/UX |
| supabase | https://github.com/supabase/agent-skills | Base de datos y Auth |
| supabase-postgres-best-practices | https://github.com/supabase/agent-skills | Postgres/RLS |
| shopify | https://github.com/Shopify/shopify-ai-toolkit | API Admin y Shopify |
| tdd | https://github.com/mattpocock/skills | Pruebas guiadas |
| diagnosing-bugs | https://github.com/mattpocock/skills | Diagnóstico de errores |
| playwright-cli | https://github.com/microsoft/playwright-cli | Pruebas de navegador |
| expo-web-to-native | https://github.com/expo/skills | Migración a apps móviles |

Google Antigravity: abrir BOLT con la rama integrada y revisar `.agents/skills/`. En el panel del agente usar `/<nombre-de-skill>` cuando sea necesario. Las skills se cargan por proyecto, **no globalmente**.

Las fuentes y licencias pertenecen a sus respectivos autores. Antes de ejecutar scripts externos revisar procedencia, privilegios, y telemetría; la skill Shopify trae un hook de telemetría. No conectar credenciales reales ni desplegar cambios sin revisiones y pruebas. Las referencias auxiliares de las skills se incorporan en pasos posteriores, de forma incremental; para cualquier referencia no incluida, consultar la fuente oficial indicada.
