# 🔨 Build — Implementation

> **Propósito:** Implementar la solución planificada siguiendo las convenciones del proyecto. Escribir tests junto con el código.
> **Artefactos que produce:** `implementation_notes` (notas de implementación), `code_diff` (resumen de cambios)

---

## Paso 1: Revisar Arquitectura y Plan de Pruebas

**Objetivo:** Entender qué implementar y cómo verificarlo.

**Acciones del agente:**
1. Lee el `architecture_doc` del artifact store (producido en Plan)
2. Lee el `test_plan` del artifact store
3. Si no hay architecture_doc, pídele al usuario que ejecute `/sprint plan` primero
4. Identifica el orden de implementación (dependencias entre componentes)

**Validación:** ¿Sabes exactamente qué archivos crear/modificar y en qué orden?

---

## Paso 2: Explorar Base de Código

**Objetivo:** Entender las convenciones y patrones existentes.

**Acciones del agente:**
1. Lee archivos existentes similares a los que vas a crear/modificar
2. Revisa `package.json` para dependencias disponibles
3. Revisa `.env.example` para variables de entorno necesarias
4. Instala dependencias faltantes si es necesario
5. Identifica el estilo de código del proyecto (nombres, estructura, imports)

**Validación:** ¿Entiendes las convenciones del proyecto?

---

## Paso 3: Implementar

**Objetivo:** Escribir el código siguiendo la arquitectura definida.

**Acciones del agente:**
1. Implementa los componentes en el orden definido (primero estructura, luego lógica)
2. Escribe tests unitarios para cada componente (TDD recomendado)
3. Sigue las convenciones del proyecto
4. NO implementes funcionalidad fuera del alcance definido en el architecture_doc
5. Commitea frecuentemente con mensajes convencionales

**Reglas de código:**
- Usa `import`/`export` (ESM) — no `require`
- Usa `async/await` para operaciones asíncronas
- Maneja errores con try/catch
- Nombres descriptivos en inglés
- Una responsabilidad por función/archivo
- Tests primero (Red-Green-Refactor)

**Validación:** ¿El código compila/ejecuta sin errores? ¿Los tests pasan?

---

## Paso 4: Verificar Integración

**Objetivo:** Asegurar que el código nuevo funciona con el sistema existente.

**Acciones del agente:**
1. Verifica que los imports sean correctos
2. Verifica que las APIs expuestas sean coherentes con el architecture_doc
3. Ejecuta los tests existentes para verificar que no se rompió nada
4. Si aplica, prueba el flujo completo manualmente
5. Ejecuta el linter si está configurado

**Validación:** ¿El código se integra correctamente sin romper nada existente?

---

## Paso 5: Documentar y Pasar a Review

**Objetivo:** Entregar el código completo para revisión.

**Artefactos a producir:**
- `implementation_notes` — Notas sobre decisiones de implementación, desviaciones del plan, problemas encontrados
- `code_diff` — Resumen de archivos creados/modificados/eliminados

**Formato de implementation_notes:**
```markdown
## Implementation Notes

### Files Created
- `path/file.js` — Propósito

### Files Modified
- `path/file.js` — Cambios realizados

### Deviations from Plan
- [Si te desviaste del architecture_doc, explica por qué]

### Issues Encountered
- [Problemas y cómo se resolvieron]

### Test Coverage
- Unit tests: X/Y passing
- Integration tests: X/Y passing
```

**Validación:** ¿El código está listo para ser revisado por un Staff Engineer?
