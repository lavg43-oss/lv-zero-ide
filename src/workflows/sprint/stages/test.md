# 🧪 Test — QA & Verification

> **Propósito:** Automated QA: run tests, verify flows, capture screenshots, generate regression tests for fixes.
> **Inspiración:** gstack `/qa`
> **Artefactos que produce:** `qa_report` (reporte de QA)

---

## Paso 1: Revisar Plan de Pruebas

**Objetivo:** Entender qué pruebas ejecutar y qué criterios de aceptación verificar.

**Acciones del agente:**
1. Lee el `test_plan` del artifact store (producido en Plan)
2. Lee el `review_report` del artifact store (para conocer bugs encontrados)
3. Identifica qué pruebas unitarias y de integración existen
4. Identifica qué flujos manuales verificar

**Validación:** ¿Sabes exactamente qué verificar y cómo?

---

## Paso 2: Ejecutar Pruebas Automatizadas

**Objetivo:** Verificar que todas las pruebas pasan.

**Acciones del agente:**
1. Ejecuta `npm test` o el comando de pruebas del proyecto
2. Si hay tests fallidos, investiga la causa:
   - ¿Es un bug nuevo introducido por los cambios?
   - ¿Es un test flaky (intermitente)?
   - ¿Es un test existente que se rompió?
3. Para bugs nuevos, intenta fixearlos
4. Para tests flaky, documéntalos
5. Reporta resultados detallados (cuántos pasaron, cuántos fallaron, cuáles)

**Validación:** ¿Todos los tests pasan? Si no, ¿sabes por qué?

---

## Paso 3: Verificación Manual de Flujos

**Objetivo:** Probar los flujos críticos que las pruebas automatizadas no cubren.

**Acciones del agente:**
1. Identifica los 3-5 flujos de usuario más críticos
2. Para cada flujo, verifica:
   - El flujo feliz funciona
   - Los manejos de error funcionan
   - Los edge cases están cubiertos
3. Si hay UI, verifica que los cambios se vean correctamente
4. Documenta cualquier problema encontrado

**Validación:** ¿Los flujos críticos funcionan correctamente?

---

## Paso 4: Generar Reporte de QA

**Objetivo:** Documentar los resultados de las pruebas.

**Artefactos a producir:**
- `qa_report` — Reporte completo de QA con resultados, bugs encontrados, y veredicto

**Formato del qa_report:**
```markdown
## QA Report

### Automated Tests
- **Total:** N tests
- **Passed:** N
- **Failed:** N
- **Skipped:** N
- **Coverage:** X%

### Failed Tests Details
| Test | File | Error | Possible Fix |
|------|------|-------|-------------|
| name | path | error | suggestion |

### Manual Verification
| Flow | Status | Notes |
|------|--------|-------|
| Flow 1 | ✅/❌ | Notas |

### Bugs Found During QA
| # | Severity | Description | Status |
|---|----------|-------------|--------|
| 1 | HIGH | Descripción | Fixed / Unfixed |

### Regression Tests Generated
- [ ] Test 1: descripción
- [ ] Test 2: descripción

### Verdict
- **PASS** — All critical flows verified, no blocking issues
- **PASS WITH CONCERNS** — Minor issues found, non-blocking
- **FAIL** — Blocking issues found, needs fixes before ship
```

**Validación:** ¿El reporte es lo suficientemente detallado para que el Release Engineer decida si puede shippear?
