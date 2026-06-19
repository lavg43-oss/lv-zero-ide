# Code Workflow

> **Propósito:** Implementar código a partir de una especificación o requerimiento
> **Comando:** `/code`
> **Pasos:** 5

---

## Paso 1: Entender la Especificación
**Objetivo:** Tener claro QUÉ hay que implementar.

**Acciones del agente:**
1. Si hay un plan en PLAN.md → léelo
2. Si no hay plan → revisa el requerimiento directamente
3. Identifica qué archivos necesitas crear o modificar
4. Identifica el stack tecnológico (lenguaje, frameworks, APIs)

**Validación:** ¿Sabes exactamente qué archivos tocar y qué tecnología usar?

---

## Paso 2: Explorar Base de Código
**Objetivo:** Entender las convenciones y patrones existentes antes de escribir código nuevo.

**Acciones del agente:**
1. Lee archivos existentes similares a los que vas a crear/modificar
2. Si hay novedades, usa `code_mapper parseFile` para extraer estructura
3. Revisa `package.json` para dependencias disponibles
4. Revisa `.env.example` para variables de entorno necesarias
5. Instala dependencias faltantes con `shell_executor`

**Validación:** ¿Entiendes las convenciones del proyecto?

---

## Paso 3: Implementar
**Objetivo:** Escribir el código.

**Acciones del agente:**
1. Escribe los archivos usando `file_manager write`
2. Sigue las convenciones del proyecto (nombres, estructura, imports)
3. Implementa primero la estructura (interfaces/types), luego la lógica
4. Agrega comentarios donde la lógica no sea obvia
5. NO implementes funcionalidad fuera del alcance definido

**Reglas de código:**
- Usa `import`/`export` (ESM) — no `require`
- Usa `async/await` para operaciones asíncronas
- Maneja errores con try/catch
- Nombres descriptivos en inglés
- Una responsabilidad por función/archivo

**Validación:** ¿El código compila/ejecuta sin errores?

---

## Paso 4: Verificar Integración
**Objetivo:** Asegurar que el código nuevo funciona con el sistema existente.

**Acciones del agente:**
1. Lee los archivos modificados para verificar consistencia
2. Verifica que los imports sean correctos
3. Verifica que las APIs expuestas sean coherentes
4. Si hay tests, verifica que los existentes sigan pasando
5. Si aplica, prueba el flujo completo

**Validación:** ¿El código se integra correctamente sin romper nada?

---

## Paso 5: Presentar Resultado
**Objetivo:** Entregar el código completo al usuario.

**Acciones del agente:**
1. Muestra un resumen de lo implementado
2. Lista los archivos creados/modificados
3. Destaca decisiones técnicas importantes
4. Menciona si algo queda pendiente o fuera de alcance
5. Actualiza PLAN.md con el progreso

**Validación:** ¿El usuario confirmó que la implementación cumple el objetivo?
