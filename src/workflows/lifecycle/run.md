# Run Workflow

> **Propósito:** Detectar el tipo de proyecto y ejecutar comandos pre-configurados con verificaciones previas
> **Comando:** `/run`
> **Pasos:** 3

---

## Paso 1: Detectar Entorno
**Objetivo:** Identificar el tipo de proyecto y sus run targets disponibles.

**Acciones del agente:**
1. Ejecuta `detectEnvironment(projectPath)` para identificar:
   - Node.js (package.json) → npm scripts
   - Python (requirements.txt, setup.py, pyproject.toml) → python/flask commands
   - Docker (Dockerfile, docker-compose.yml) → docker compose commands
   - Make (Makefile) → make targets
   - .NET (.sln, .csproj) → dotnet commands
   - Web Static (index.html) → npx serve
   - Rust (Cargo.toml) → cargo commands
   - Go (go.mod) → go commands
   - Ruby (Gemfile) → rails/bundle commands
2. Muestra el tipo de entorno detectado (badge/etiqueta)
3. Lista los targets disponibles como botones de acción rápida

**Validación:** ¿Se detectó correctamente el tipo de proyecto?

---

## Paso 2: Pre-Checks
**Objetivo:** Verificar que el entorno está listo para ejecutar.

**Acciones del agente:**
1. Ejecuta `preRunCheck(projectPath, target)` que verifica:
   - Conflictos de puertos (3000, 4000, 5000, 8080, 5173)
   - Variables de entorno faltantes (.env.example vs .env)
   - Dependencias instaladas (node_modules/, .venv/)
   - Estado de git (cambios sin commit)
2. Muestra warnings si existen
3. Si hay errores bloqueantes, muestra advertencia antes de ejecutar

**Validación:** ¿El entorno pasa las verificaciones previas?

---

## Paso 3: Ejecutar Comando
**Objetivo:** Ejecutar el comando seleccionado en la terminal.

**Acciones del agente:**
1. Genera el comando completo con `generateRunCommand(projectPath, target)`
2. Si hay configuración personalizada en `.lv-zero/run-config.json`, la aplica
3. Ejecuta el comando en la terminal vía `terminal:execCommand`
4. Muestra el output en tiempo real

**Validación:** ¿El comando se ejecutó correctamente?

---

## Resumen

El workflow completo produce:
- `type`: Tipo de proyecto detectado (node, python, docker, etc.)
- `label`: Etiqueta legible del entorno
- `targets[]`: Lista de targets disponibles con nombre, comando y descripción
- `warnings[]`: Advertencias del pre-check
- `errors[]`: Errores bloqueantes del pre-check
- `executed`: Comando que se ejecutó
- `result`: Resultado de la ejecución
