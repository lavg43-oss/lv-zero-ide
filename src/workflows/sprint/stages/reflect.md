# 🔍 Reflect — Retrospective

> **Propósito:** Team-aware weekly retro with trends and growth opportunities.
> **Inspiración:** gstack `/retro`
> **Artefactos que produce:** `retro_notes` (notas de retrospectiva), `action_items` (items de acción)

---

## Paso 1: Revisar el Sprint Completo

**Objetivo:** Tener una visión completa de lo que ocurrió en el sprint.

**Acciones del agente:**
1. Revisa todos los artefactos producidos durante el sprint:
   - `design_doc` (Think)
   - `architecture_doc` (Plan)
   - `implementation_notes` (Build)
   - `review_report` (Review)
   - `qa_report` (Test)
   - `release_notes` (Ship)
2. Revisa el stage history del pipeline
3. Identifica el tiempo total y esfuerzo invertido

**Validación:** ¿Tienes una visión completa del sprint?

---

## Paso 2: Analizar Qué Funcionó

**Objetivo:** Identificar patrones exitosos para repetirlos.

**Preguntas:**
- ¿Qué etapas del pipeline fluyeron sin problemas?
- ¿Qué decisiones técnicas resultaron ser correctas?
- ¿Qué herramientas o prácticas ayudaron más?
- ¿Qué se entregó a tiempo y por qué?
- ¿Qué bugs se atraparon temprano gracias al proceso?

**Validación:** ¿Puedes identificar al menos 3 cosas que funcionaron bien?

---

## Paso 3: Analizar Qué No Funcionó

**Objetivo:** Identificar áreas de mejora sin señalar culpables.

**Preguntas:**
- ¿Qué etapas del pipeline tuvieron problemas?
- ¿Qué decisiones técnicas resultaron incorrectas?
- ¿Qué bugs llegaron a producción?
- ¿Qué se entregó tarde y por qué?
- ¿Hubo requisitos que cambiaron a mitad del sprint?
- ¿Faltó información en alguna etapa?

**Validación:** ¿Puedes identificar al menos 3 cosas que mejorar?

---

## Paso 4: Definir Action Items

**Objetivo:** Convertir el aprendizaje en acciones concretas.

**Acciones del agente:**
1. Para cada problema identificado, define un action item específico
2. Asigna dueño (puede ser el agente mismo o el usuario)
3. Define criterios de éxito para cada action item
4. Prioriza los action items por impacto

**Artefactos a producir:**
- `retro_notes` — Notas completas de la retrospectiva
- `action_items` — Items de acción para el próximo sprint

**Formato de action_items:**
```markdown
## Action Items

### Must Fix (Alta Prioridad)
| # | Action Item | Dueño | Criterio de Éxito |
|---|-------------|-------|-------------------|
| 1 | Descripción | @user | Cómo saber que está resuelto |

### Should Improve (Media Prioridad)
| # | Action Item | Dueño | Criterio de Éxito |
|---|-------------|-------|-------------------|

### Nice to Have (Baja Prioridad)
| # | Action Item | Dueño | Criterio de Éxito |
|---|-------------|-------|-------------------|
```

**Formato de retro_notes:**
```markdown
## Retrospective: Sprint [ID]

### Sprint Stats
- **Duración:** X días
- **Etapas completadas:** X/7
- **Artefactos producidos:** N
- **Bugs encontrados:** N (HIGH: X, MEDIUM: Y, LOW: Z)
- **Bugs que llegaron a producción:** N

### What Went Well 🌟
1. [Logro] — [Por qué funcionó]
2. [Logro] — [Por qué funcionó]

### What Could Be Improved 🔧
1. [Problema] — [Causa raíz]
2. [Problema] — [Causa raíz]

### Action Items
[Referencia al action_items]

### Shoutouts 🎉
- [Reconocimiento a algo específico que alguien hizo bien]
```

**Validación:** ¿Cada problema tiene un action item concreto y medible?

---

## Paso 5: Cerrar el Sprint

**Objetivo:** Dejar todo listo para el próximo sprint.

**Acciones del agente:**
1. Guarda la retrospectiva en el artifact store
2. Si hay integración con herramientas externas (Slack, Notion), comparte el resumen
3. Prepara el contexto para el próximo sprint (action items como punto de partida)
4. Limpia los artifacts temporales si es necesario

**Validación:** ¿El sprint está oficialmente cerrado? ¿El equipo tiene claro qué mejorar?
