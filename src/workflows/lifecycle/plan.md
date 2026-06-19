# Plan Workflow

> **Propósito:** Diseñar arquitectura y plan de acción antes de codificar
> **Comando:** `/plan`
> **Pasos:** 4

---

## Paso 1: Analizar Requerimientos
**Objetivo:** Entender QUÉ necesita el usuario y POR QUÉ.

**Acciones del agente:**
1. Parafrasea el objetivo del usuario en tus palabras
2. Identifica restricciones (tecnologías, plazos, recursos)
3. Identifica criterios de éxito — ¿cómo sabemos que está completo?
4. Pregunta al usuario si algo no está claro (máx 2 preguntas)

**Validación:** ¿Puedes explicar el objetivo en 2 oraciones?

---

## Paso 2: Explorar Contexto
**Objetivo:** Revisar el estado actual del proyecto antes de planificar.

**Acciones del agente:**
1. Revisa `package.json` para entender dependencias y scripts
2. Revisa estructura de directorios con `file_manager list`
3. Revisa archivos relevantes existentes
4. Revisa `.env` para configuración disponible
5. Si involucra base de datos → usa `db_explorer get_schema`

**Validación:** ¿Tienes claro el estado actual del proyecto?

---

## Paso 3: Diseñar Arquitectura
**Objetivo:** Definir la solución antes de codificar.

**Acciones del agente:**
1. Define los componentes/archivos necesarios
2. Define las interacciones entre componentes
3. Define el flujo de datos
4. Identifica riesgos potenciales
5. Documenta la arquitectura en PLAN.md

**Formato en PLAN.md:**
```markdown
# Plan: [Nombre del proyecto/feature]

## Arquitectura
[Diagrama de componentes en texto]

## Archivos a modificar
- `src/file1.js` — [propósito]
- `src/file2.js` — [propósito]

## Flujo
1. [Paso 1]
2. [Paso 2]
...

## Riesgos
- [Riesgo 1] → [Mitigación]
```

**Validación:** ¿El plan es lo suficientemente detallado para que otro desarrollador lo ejecute?

---

## Paso 4: Validar y Presentar
**Objetivo:** Confirmar que el plan es correcto antes de pasar a `/code`.

**Acciones del agente:**
1. Revisa el plan completo
2. Verifica que no falten componentes
3. Verifica que el plan responde al objetivo original
4. Presenta el plan al usuario
5. Pregunta: "¿Aprobado? Si es así, ejecuta `/code` para empezar la implementación."

**Validación:** ¿El usuario aprobó el plan?
