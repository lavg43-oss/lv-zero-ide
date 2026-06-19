# Debug Workflow

> **Propósito:** Diagnosticar y corregir errores de forma sistemática
> **Comando:** `/debug`
> **Pasos:** 5

---

## Paso 1: Reproducir el Error
**Objetivo:** Confirmar que el error existe y entender sus síntomas.

**Acciones del agente:**
1. Pide al usuario el mensaje de error COMPLETO (no resumido)
2. Pide el contexto: ¿qué estabas haciendo cuando ocurrió?
3. Si hay stack trace, analízalo línea por línea
4. Intenta reproducir el error ejecutando el comando o código relevante
5. Documenta: qué se esperaba vs qué ocurrió

**Validación:** ¿Puedes reproducir el error consistentemente?

---

## Paso 2: Aislar la Causa Raíz
**Objetivo:** Encontrar la línea de código o configuración que causa el error.

**Acciones del agente:**
1. Lee el archivo donde ocurre el error (según stack trace)
2. Busca causas comunes:
   - **Sintaxis**: typo, paréntesis faltante, import incorrecto
   - **Tipos**: null reference, undefined property, type mismatch
   - **Lógica**: condición incorrecta, bucle infinito, off-by-one
   - **Configuración**: API key faltante, URL incorrecta, permiso denegado
   - **Dependencias**: versión incorrecta, paquete faltante
3. Usa `code_mapper parseFile` para entender la estructura del archivo problemático
4. Lee el archivo completo si es necesario para entender el flujo

**Técnicas de diagnóstico:**
- Divide y vencerás: comenta bloques para encontrar cuál causa el error
- Variables de estado: verifica qué valores tienen las variables clave
- Logs estratégicos: identifica dónde agregar `console.log` temporal

**Validación:** ¿Puedes señalar la línea EXACTA que causa el error?

---

## Paso 3: Diseñar la Corrección
**Objetivo:** Definir qué cambiar sin causar efectos secundarios.

**Acciones del agente:**
1. Define el cambio mínimo necesario para corregir el error
2. Verifica que el cambio no rompa otras funcionalidades
3. Si el cambio es complejo, documéntalo antes de implementar
4. Identifica si hay archivos adicionales que necesitan cambios

**Preguntas de validación:**
- ¿Este cambio solo afecta al error o tiene side effects?
- ¿Hay tests que puedan romperse?
- ¿Es la solución más simple posible?

**Validación:** ¿Tienes una hipótesis clara de qué cambiar y por qué?

---

## Paso 4: Implementar la Corrección
**Objetivo:** Aplicar el cambio y verificar que funciona.

**Acciones del agente:**
1. Lee el archivo que vas a modificar
2. Aplica el cambio usando `file_manager write`
3. Vuelve a ejecutar el comando o código que fallaba
4. Si el error persiste → vuelve al Paso 2
5. Si el error se resuelve → continúa al Paso 5

**Reglas:**
- Cambia UNA cosa a la vez
- Después de cada cambio, prueba
- Si después de 3 intentos no hay solución → cambia de estrategia (no sigas martillando)

**Validación:** ¿El error ya no se reproduce?

---

## Paso 5: Verificar y Documentar
**Objetivo:** Asegurar estabilidad y dejar registro de la solución.

**Acciones del agente:**
1. Confirma que el flujo completo funciona (no solo la parte que fallaba)
2. Si hay tests relevantes, ejecútalos
3. Remueve logs temporales que agregaste para depurar
4. Documenta brevemente: cuál era el error, cuál la causa raíz, cuál la solución
5. Actualiza PLAN.md

**Validación:** ¿El sistema queda estable y documentado?
