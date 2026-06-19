# 👁️ Review — Code Review

> **Propósito:** Staff-engineer-level code review. Find bugs that pass CI but blow up in production. Auto-fix obvious ones.
> **Inspiración:** gstack `/review`
> **Artefactos que produce:** `review_report` (reporte de revisión)

---

## Paso 1: Entender los Cambios

**Objetivo:** Obtener el contexto completo de lo que se implementó.

**Acciones del agente:**
1. Lee el `architecture_doc` del artifact store (para entender qué se esperaba)
2. Lee el `implementation_notes` del artifact store (para entender qué se hizo)
3. Obtén el diff usando `execute_command` con `git diff main...HEAD` o revisa los archivos
4. Identifica el alcance y riesgo de los cambios

**Validación:** ¿Entiendes qué se intentó lograr y qué cambió realmente?

---

## Paso 2: Análisis Profundo

**Objetivo:** Encontrar bugs, problemas de seguridad y maintainability.

**Para cada archivo modificado, revisa:**

### Errores de Lógica
- Off-by-one en loops y acceso a arrays
- Operadores de comparación incorrectos (`=` vs `==` vs `===`)
- Falta de checks de null/undefined
- Suposiciones incorrectas sobre la forma de los datos
- Race conditions en código asíncrono
- Errores silenciados (catch vacíos)

### Problemas de Seguridad
- SQL injection (concatenación de strings en queries)
- Path traversal (input de usuario en rutas sin validación)
- XSS (input de usuario renderizado sin escape)
- Hardcoded secrets, API keys o tokens
- Falta de autenticación/autorización

### Problemas de Performance
- N+1 queries en loops
- Operaciones síncronas que deberían ser asíncronas
- Memory leaks (event listeners no limpiados)

### Problemas de Mantenibilidad
- Magic numbers o strings sin constantes nombradas
- Condicionales anidados (>3 niveles)
- Funciones que hacen demasiadas cosas
- Código muerto o comentado

**Validación:** ¿Has revisado cada archivo con ojo crítico?

---

## Paso 3: Reportar

**Objetivo:** Entregar un reporte estructurado con hallazgos.

**Artefactos a producir:**
- `review_report` — Reporte de revisión con hallazgos, severidades y fixes aplicados

**Formato del review_report:**
```markdown
## Review Report

### ✅ What's Good
- (aspectos positivos)

### 🐛 Bugs Found
| # | File | Line | Severity | Issue | Fix |
|---|------|------|----------|-------|-----|
| 1 | path/file.js | 42 | HIGH | Descripción | Fix sugerido |

### ⚠️ Concerns
- (issues no bloqueantes, sugerencias)

### 📊 Summary
- Files reviewed: N
- Bugs found: N (X HIGH, Y MEDIUM, Z LOW)
- Auto-fixes applied: N
- Verdict: APPROVED / CHANGES REQUESTED / NEEDS DISCUSSION
```

### Severidad
| Severidad | Significado | Acción |
|-----------|-------------|--------|
| **HIGH** | Bug de producción, pérdida de datos, security breach | Debe fixearse antes de merge |
| **MEDIUM** | Bug probable o maintainability issue significativo | Debería fixearse |
| **LOW** | Issue menor, estilo, sugerencia | Considerar fix |

## Auto-Fix Rules

Para bugs obvios (typos, null checks faltantes, comparaciones incorrectas), **fixéalos inmediatamente** usando `apply_diff` e incluye el fix en el reporte.

NO auto-fixees:
- Decisiones arquitectónicas
- Patrones de diseño
- Optimizaciones que necesitan discusión
- Cambios que alteran comportamiento sin entender la intención

**Validación:** ¿El reporte es lo suficientemente detallado para que el autor entienda qué cambiar?
