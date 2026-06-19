# 💡 Think — Problem Framing

> **Propósito:** Seis forcing questions que replantean el problema. Desafía premisas, genera alternativas, encuentra la oportunidad 10x.
> **Inspiración:** gstack `/office-hours` (YC Office Hours)
> **Artefactos que produce:** `design_doc` (documento de diseño inicial)

---

## Paso 1: Entender el Problema

**Objetivo:** Antes de pensar en soluciones, asegúrate de entender el problema real.

**Acciones del agente:**
1. Parafrasea el problema en tus propias palabras
2. Identifica: ¿Quién es el usuario? ¿Cuál es el dolor real?
3. Identifica: ¿Qué pasa si NO resolvemos esto?
4. Identifica: ¿Hay algo más grande detrás de lo que pide el usuario?

**Preguntas forcing (YC Office Hours):**
- ¿Por qué esto ahora? ¿Qué cambió?
- ¿Quién más ha intentado esto y por qué fallaron?
- ¿Cuál es la versión 10x de esta idea?
- Si esto funciona, ¿a qué más le abre la puerta?
- ¿Cuál es el riesgo más grande que estás ignorando?
- ¿Cómo sabrás si esto fue un éxito en 3 meses?

**Validación:** ¿Puedes explicar el problema en 2 oraciones que un niño de 10 años entendería?

---

## Paso 2: Explorar el Espacio de Soluciones

**Objetivo:** Generar alternativas antes de comprometerse con una dirección.

**Acciones del agente:**
1. Genera 3 enfoques diferentes para resolver el problema
2. Para cada enfoque, identifica:
   - ¿Qué tan complejo es implementarlo?
   - ¿Qué tan bien escala?
   - ¿Qué tan mantenible es a largo plazo?
   - ¿Qué riesgos introduce?
3. Recomienda el mejor enfoque con justificación

**Validación:** ¿Has considerado al menos 3 enfoques diferentes?

---

## Paso 3: Definir Criterios de Éxito

**Objetivo:** Saber exactamente qué significa "terminado".

**Acciones del agente:**
1. Define 3-5 criterios de éxito medibles
2. Define qué NO está en alcance (para evitar scope creep)
3. Define el mínimo producto viable (MVP)
4. Estima el esfuerzo en puntos de historia o días ideales

**Validación:** ¿Puedes decir con certeza "esto está completo" cuando se cumplan los criterios?

---

## Paso 4: Documentar y Pasar a Plan

**Objetivo:** Capturar todo el análisis para la siguiente etapa.

**Artefactos a producir:**
- `design_doc` — Documento de diseño con problema, enfoque recomendado, criterios de éxito

**Formato del design_doc:**
```markdown
# Design Doc: [Título]

## Problema
[2 oraciones]

## Enfoques Considerados
1. [Enfoque A] — Pros/Cons
2. [Enfoque B] — Pros/Cons
3. [Enfoque C] — Pros/Cons

## Enfoque Recomendado
[Justificación]

## Criterios de Éxito
- [ ] Criterio 1
- [ ] Criterio 2
- [ ] Criterio 3

## Fuera de Alcance
- [Lo que NO se hará]

## Riesgos
- [Riesgo] → [Mitigación]
```

**Validación:** ¿El design_doc tiene suficiente detalle para que un ingeniero empiece a planificar la arquitectura?
