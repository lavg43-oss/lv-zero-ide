# Review Workflow

> **Propósito:** Revisar código existente para calidad, seguridad y mejores prácticas
> **Comando:** `/review`
> **Pasos:** 4

---

## Paso 1: Identificar el Alcance
**Objetivo:** Saber exactamente qué código revisar.

**Acciones del agente:**
1. Si el usuario especificó archivos → úsalos
2. Si no, pregunta qué revisar o sugiere basado en cambios recientes
3. Determina el tipo de review:
   - **Full review**: Todo el archivo
   - **Diff review**: Solo cambios recientes
   - **Focused review**: Función o módulo específico

**Validación:** ¿Está claro el alcance de la revisión?

---

## Paso 2: Análisis Estático
**Objetivo:** Evaluar estructura, legibilidad y patrones sin ejecutar el código.

**Acciones del agente:**
1. Usa `code_mapper parseFile` para extraer estructura
2. Lee el archivo completo línea por línea
3. Evalúa estas dimensiones:

**Legibilidad (1-10)**
- ¿Nombres descriptivos?
- ¿Comentarios donde es necesario?
- ¿Formato consistente?
- ¿Complejidad ciclomática manejable?

**Mantenibilidad (1-10)**
- ¿Funciones con una sola responsabilidad?
- ¿Archivos con una sola responsabilidad?
- ¿DRY (no repites código)?
- ¿Acoplamiento bajo?

**Seguridad (PASS/FAIL)**
- ¿Validación de inputs?
- ¿Inyección SQL? (concatenación de strings)
- ¿Exposición de secrets/API keys?
- ¿Path traversal?

**Validación:** ¿Tienes una evaluación completa del código?

---

## Paso 3: Análisis Dinámico (si aplica)
**Objetivo:** Evaluar comportamiento en ejecución.

**Acciones del agente:**
1. Si hay tests → ejecútalos
2. Si el código expone una API → verifica los endpoints
3. Si es una función → verifica edge cases
4. Evalúa:
   - ¿Manejo de errores adecuado?
   - ¿Casos borde cubiertos?
   - ¿Performance aceptable?

**Validación:** ¿El código funciona correctamente en todos los escenarios?

---

## Paso 4: Reportar Hallazgos
**Objetivo:** Entregar un reporte de revisión claro y accionable.

**Acciones del agente:**
1. Clasifica cada hallazgo por severidad:
   - 🔴 **Crítico**: Debe corregirse antes de mergear
   - 🟡 **Advertencia**: Debería corregirse, no blocker
   - 🟢 **Sugerencia**: Mejora opcional
   - 💡 **Elogio**: Algo que está bien hecho

2. Para cada hallazgo incluye:
   - Línea exacta del código
   - Por qué es un problema
   - Cómo corregirlo (con ejemplo de código)

3. Concluye con:
   - Rating general (APROBADO / APROBADO CON CAMBIOS / RECHAZADO)
   - Resumen de hallazgos
   - Siguiente paso recomendado

**Validación:** ¿El reporte es claro y accionable para el desarrollador?
