# 📋 Plan — Architecture & Design

> **Propósito:** Lock architecture, data flow, diagrams, edge cases, and test strategy before writing code.
> **Inspiración:** gstack `/plan-ceo-review` + `/plan-eng-review`
> **Artefactos que produce:** `architecture_doc` (arquitectura detallada), `test_plan` (plan de pruebas)

---

## Paso 1: Revisar Design Doc

**Objetivo:** Entender el problema y el enfoque recomendado desde la etapa Think.

**Acciones del agente:**
1. Lee el `design_doc` del artifact store (producido en Think)
2. Si no hay design doc, pídele al usuario que ejecute `/sprint think` primero
3. Identifica los componentes principales necesarios
4. Identifica el stack tecnológico

**Validación:** ¿Entiendes completamente qué hay que construir y por qué?

---

## Paso 2: Diseñar Arquitectura

**Objetivo:** Definir la solución técnica detallada.

**Acciones del agente:**
1. Define los componentes/archivos necesarios
2. Define las interacciones entre componentes (API, eventos, datos)
3. Define el flujo de datos completo
4. Define el schema de datos si aplica
5. Identifica puntos de integración con sistemas existentes
6. Identifica riesgos técnicos y mitigaciones

**Formato de arquitectura:**
```markdown
## Arquitectura

### Componentes
- `src/file1.js` — Propósito, responsabilidades
- `src/file2.js` — Propósito, responsabilidades

### Flujo de Datos
1. [Paso 1] → [Paso 2] → [Paso 3]

### API / Interfaces
- `functionName(params)` → `returnType`

### Schema
- Tabla/Modelo: campos, tipos, relaciones

### Riesgos Técnicos
- [Riesgo] → [Mitigación]
```

**Validación:** ¿La arquitectura es lo suficientemente detallada para implementar sin ambigüedad?

---

## Paso 3: Planificar Pruebas

**Objetivo:** Definir cómo se va a verificar que la implementación funciona.

**Acciones del agente:**
1. Define casos de prueba unitarios para cada componente
2. Define casos de prueba de integración
3. Define escenarios edge case
4. Define criterios de aceptación por historia de usuario

**Formato del test_plan:**
```markdown
## Test Plan

### Unit Tests
- [ ] Test 1: descripción
- [ ] Test 2: descripción

### Integration Tests
- [ ] Test 1: descripción

### Edge Cases
- [ ] Caso 1: descripción

### Acceptance Criteria
- [ ] Criterio 1
```

**Validación:** ¿Los tests cubren los criterios de éxito definidos en Think?

---

## Paso 4: Documentar y Pasar a Build

**Objetivo:** Entregar toda la especificación a la etapa de implementación.

**Artefactos a producir:**
- `architecture_doc` — Arquitectura detallada con componentes, flujos, schema
- `test_plan` — Plan de pruebas con casos unitarios, integración, edge cases

**Validación:** ¿Un ingeniero podría implementar esto sin hacer preguntas?
