# Deploy Workflow

> **Propósito:** Ejecutar pipeline de deploy con pre-audit, build, smoke test, release tracking y rollback prep
> **Comando:** `/deploy`
> **Pasos:** 5

---

## Paso 1: Pre-Audit
**Objetivo:** Verificar que el proyecto está listo para deploy.

**Acciones del agente:**
1. Ejecuta `preAudit(projectPath)` — verifica:
   - Tests saltados (`.lv-zero/skipped-tests.json`)
   - Cambios sin commit (git status --porcelain)
   - Vulnerabilidades de dependencias (npm audit)
   - Tareas críticas incompletas en Symphony
   - Protección de producción en viernes (Friday block after 14:00)
2. Revisa los resultados — warnings y blocks
3. Si hay blocks y no se usa `force: true`, detén el pipeline

**Validación:** ¿El proyecto pasa la auditoría pre-deploy?

---

## Paso 2: Build
**Objetivo:** Compilar/construir el proyecto.

**Acciones del agente:**
1. Detecta el sistema de build:
   - `npm run build` (package.json)
   - `make` (Makefile)
   - `docker build` (Dockerfile)
   - `python setup.py build` (setup.py)
   - `cargo build` (Cargo.toml)
2. Ejecuta el comando de build
3. Captura output y errores

**Validación:** ¿El build se completó sin errores?

---

## Paso 3: Smoke Test
**Objetivo:** Verificar que el build funciona correctamente.

**Acciones del agente:**
1. Verifica que el archivo principal existe (index.js, main.cjs, etc.)
2. Confirma que las dependencias están instaladas (node_modules/)
3. Revisa archivos de configuración (.env, package.json)
4. Ejecuta syntax check en archivos .js/.cjs

**Validación:** ¿Los smoke tests pasan?

---

## Paso 4: Release
**Objetivo:** Generar release notes y guardar registro.

**Acciones del agente:**
1. Obtiene git log (últimos 20 commits)
2. Genera release notes con timestamp
3. Guarda en `.lv-zero/releases/release-{timestamp}.json`

**Validación:** ¿La release fue registrada correctamente?

---

## Paso 5: Rollback Prep
**Objetivo:** Preparar información de rollback.

**Acciones del agente:**
1. Verifica historial de git
2. Obtiene commit actual y anterior
3. Determina estrategia de rollback:
   - `git-revert` — si hay commit anterior
   - `backup` — si no es repo git
   - `no-previous-commit` — primer commit

**Validación:** ¿Hay estrategia de rollback disponible?

---

## Resumen

El pipeline completo produce un resultado con:
- `status`: ok | blocked | warning | error
- `steps[]`: cada paso con su estado
- `releaseId`: ID de la release generada
- `timestamp`: momento de ejecución
- `duration`: tiempo total en ms
