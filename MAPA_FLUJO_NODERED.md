# 🗺️ MAPA DE FLUJO COMPLETO - SIAE MULTIESCUELAS

> **Archivo fuente:** `C:\Users\LAVG\.node-red\flows.json`
> **Última actualización del flujo:** 10/05/2026 02:58 AM
> **Total de nodos:** 211
> **Total de Tabs (Flujos):** 7

---

## 📑 ÍNDICE DE FLUJOS

| # | Tab ID | Nombre | Nodos | Propósito |
|---|--------|--------|-------|-----------|
| 1 | `ee9d285c59b3f949` | **Flow 1** (Telegram Docente) | ~45 | Bot principal de asistencia vía Telegram |
| 2 | `04113e8e0e458c91` | **Flow 2** (Automatización Interna) | ~50 | Temporizadores, subida XML, calificaciones, correos masivos |
| 3 | `318a97469a0d14cd` | **Flow 3** (Dashboard Web) | ~70 | UI Dashboard, login, incidencias, expediente, reportes PDF |
| 4 | `601a17c5497fd2e5` | **Flow 4** (Bot Padres) | ~25 | Bot Telegram para padres/tutores |
| 5 | `bot_docente_v3` | **Flow 5** (Bot Docente Blindado) | ~35 | Bot docente con seguridad Zero Trust + máquina de estados |
| 6 | `de75ad3827f049bb` | **Panel Principal** (UI Tab) | - | Pestaña principal del Dashboard |
| 7 | `055140b153fe5a80` | **Acceso al Sistema** (UI Tab) | - | Pantalla de Login |
| 8 | `3e5f7f7ab839723d` | **Estadísticas de Asistencia** (UI Tab) | - | Reportes y gráficas |
| 9 | `d0012d20279d4dd5` | **ADMINISTRACION** (UI Tab) | - | Panel admin con PIN |

---

## 🔷 FLUJO 1: BOT TELEGRAM DOCENTE (Flow 1)

```
ID: ee9d285c59b3f949 → "Flow 1"
```

### Arquitectura General

```
[Telegram Receiver] → [Filtro de Textos] → [SQL Engine] → [Supabase HTTP] → [Formatear] → [Telegram Sender]
                          ↓                     ↑
                    [Gestor de Clics] → [UI Diseñador]
```

### Nodos Clave

| Nodo | Tipo | Función |
|------|------|---------|
| `6c02e84cbc7c0434` | telegram receiver | Recibe mensajes del bot `DJTBasistenciabot` |
| `9219757de70c49dc` | **function** | **"Filtro de Textos (Cerebro Asistencia)"** - Núcleo del flujo. Autenticación, máquina de estados |
| `941c02314beb5bca` | telegram event | Atrapa clics en botones inline |
| `e8a32051c9005677` | **function** | **"Gestor de Clics (Botones Asistencia)"** - Enruta clics a: Diseñador UI, SQL Engine, o Telegram |
| `8b9bfab31a60d8f2` | **function** | **"UI: Diseñador Asistencia"** - Genera textos de ayuda según el estado |
| `f2d534ac06487739` | **function** | **"SQL Engine (Asistencia)"** - Prepara llamadas a Supabase RPC |
| `fd8c8774f1e9b754` | http request | Conexión Supabase (dinámica) |
| `9c10a86c699ce17c` | **function** | **"Formatear Respuesta (FINAL) (Asistencia)"** - Traduce respuestas SQL a texto + controla correos |
| `d45407443bb25319` | telegram sender | Bot docente (`DJTBasistenciabot`) |
| `6ceeb1384d68ad14` | telegram sender | Envío de PDFs/doc |
| `f83d98ce73c95a6e` | **function** | **"function 12"** - Genera HTML para reporte PDF de asistencia |
| `b4cd67eddf136bf2` | **function** | **"Supabase los correos"** - Obtiene correos pendientes de notificar |
| `13fa03bc3c18fba4` | **function** | **"Redactor de Correos de Faltas"** - Agrupa faltas por familia y redacta correos |

### Máquina de Estados (Asistencia)

```
IDLE → WAIT_FALTAS → CONFIRM_FALTAS → (Yes/No)
IDLE → WAIT_RETARDO → DO_RETARDO
IDLE → WAIT_JUST_CLAVE → WAIT_JUST_FECHA → DO_JUSTIFICAR
```

### Base de Datos (RPCs llamadas)
- `previsualizar_faltas` - Vista previa de faltas
- `registrar_faltas_masivo` - Guarda faltas en lote
- `registrar_retardo` - Registra retardo individual
- `justificar_falta` - Justifica falta individual
- `reporte_diario_grupos` - Obtiene datos para PDF
- `obtener_correos_pendientes` - Correos por enviar
- `marcar_como_notificado` - Marca notificaciones como enviadas

---

## 🔷 FLUJO 2: AUTOMATIZACIÓN INTERNA (Flow 2)

```
ID: 04113e8e0e458c91 → "Flow 2"
```

### Sub-flujo 2A: Reloj de Correos Automáticos

```
[Inject cada 2 min] → [Supabase: obtener_correos_pendientes] → [Redactor] → [Email + Supabase mark]
```

### Sub-flujo 2B: Subida de Horario XML

```
[UI Template: Subir XML] → [Parse XML a JSON] → [Supabase DELETE viejo] → [Supabase INSERT nuevo]
                                                                              ↓
                                                    [Obtener contactos] → [Redactor Formal]
                                                                              ↓
                                                            [Correos a listas] + [Telegram a padres]
```

**Formato XML esperado:** aSc TimeTables (formato `<timetable>` con subjects, teachers, classes, lessons, cards)

### Sub-flujo 2C: Subida de Calificaciones PDF

```
[UI Template: Subir PDF] → [PDF.js en navegador extrae texto] → [Parser de texto]
                                                                    ↓
                                                    [Supabase RPC: procesar_calificaciones_pdf]
```

**Parser extrae:** CURP + calificaciones por materia. Usa catálogos por grado (1°, 2°, 3°)

---

## 🔷 FLUJO 3: DASHBOARD WEB (Flow 3)

```
ID: 318a97469a0d14cd → "Flow 3"
```

### Componentes UI Dashboard

| Template | Grupo | Función |
|----------|-------|---------|
| `bc7b189edb8a93a4` | Encabezado | Header con logo de la secundaria |
| `7fdb76e4b0fb41d4` | Identificación | Formulario de Login (select maestro + PIN) |
| `e22a79ccbf272d96` | Nueva incidencia | Formulario de registro de incidencias |
| `tpl_buscador_pro_v2` | Buscador de Alumnos | Búsqueda inteligente con sugerencias |
| `tpl_exp_integral_v3` | Expediente Académico | Vista completa del expediente del alumno |
| `form_filtros_v5` | Filtros y Consulta | Filtros para reportes de asistencia |
| `tabla_resultados_v6` | Resultados y Gráficas | Tabla de resultados estadísticos |
| `grafica_custom_v7` | Resultados y Gráficas | Gráfica de barras (Chart.js) |
| `generador_pdf_v5` | Resultados y Gráficas | Generador de PDF (html2pdf.js) |
| `panel_maestro_asist` | FALTAS Y JUSTIFICANTES | Gestión de faltas/retardos/justificantes |

### Flujo de Login

```
[Login Form] → [function: validar] → [Supabase: validar_login]
                                         ↓ (true/false)
                         [ui_ui_control: ocultar login, mostrar paneles]
```

### Flujo de Incidencias

```
[Form Incidencia] → [function: preparar] → [Supabase: registrar_incidencia]
                                              ↓
                                  [Traductor] → [Toast UI]
                                              ↓
                                  [Obtener tutor] → [Email + Telegram al tutor]
```

### Flujo de Expediente

```
[Buscador input] → (sugerencias) → [Supabase: buscar_alumnos_sugerencias]
                 → (búsqueda)    → [Supabase: buscar_expediente_completo]
                                     ↓
                         [Template: Expediente Pro]
```

### RPCs usadas en Flow 3
- `validar_login`
- `registrar_incidencia`
- `buscar_alumnos_sugerencias`
- `buscar_expediente_completo`
- `buscar_nombre_por_clave`
- `obtener_datos_tutor_incidencia`
- `obtener_contacto_emergencia`
- `datos_tabla_dashboard`
- `reporte_maestro_asistencia`
- `buscar_nombres_masivos`
- `registrar_falta_web`
- `registrar_retardo_web`
- `justificar_faltas_rango`

---

## 🔷 FLUJO 4: BOT TELEGRAM PADRES (Flow 4)

```
ID: 601a17c5497fd2e5 → "Flow 4"
```

### Arquitectura

```
[Telegram Receiver + Event] → [Cerebro Enrutador] → [7 salidas]
                                    ↓
            ┌──────────┬──────────┬──┴──┬──────────┬──────────┐
            ↓          ↓          ↓     ↓          ↓          ↓
       Bienvenida   Menú      Vincular  Periodos  Reporte   Horario
       (Salida1)   (Salida2)  (Salida3) (Salida4) (Salida5) (Salida6)
                                                   ↓           ↓
                                              Supabase →   Supabase →
                                              HTML PDF    HTML PDF
```

### Menú de Categorías (Botones inline)
- 📊 Asistencias y Faltas
- ⏰ Historial de Retardos
- 📜 Disciplina e Incidencias
- 🏫 Horario de Clases

### Flujo de Vinculación
```
/start → Ingresa CURP → Selecciona Parentesco → Supabase: vincular_telegram_tutor
```

### RPCs del Flow 4
- `vincular_telegram_tutor`
- `generar_reporte_padre`
- `obtener_horario_por_telegram`

---

## 🔷 FLUJO 5: BOT DOCENTE BLINDADO (bot_docente_v3)

```
ID: bot_docente_v3 → "SIAE 11 - Bot Docente (Blindado)"
```

### Arquitectura (3 entradas)

```
[Telegram Receiver] → [Router Textos (3 salidas)]
                         Salida1 → [Telegram Sender]
                         Salida2 → [SQL Engine]
                         Salida3 → [UI Diseñador]

[Telegram Event] → [Router Botones (3 salidas)]
                      Salida1 → [UI Diseñador]
                      Salida2 → [SQL Engine]
                      Salida3 → [Telegram Sender]
```

### Menú Principal (Botones inline)
- 📅 Mi Horario
- 🏫 Horarios de Grupos
- 🚨 Contacto Emergencia
- 📜 Reporte Disciplina
- 🔎 Ver Historial Disciplina
- 🏥 Justificar Faltas

### Flujo de Reporte Disciplina (Paso a paso)
```
1. Ingresa clave del alumno
2. Selecciona tipo: Incidencia / Reporte / Citatorio
3. Selecciona motivo: Falta de Respeto / Uso de Celular / No trabaja / Agresión / Otro
4. Escribe descripción
5. Ingresa PIN de seguridad
6. → Supabase: registrar_incidencia
7. → Notifica a tutores vía Telegram + Correo
```

### Reloj Inteligente (Tick cada 60s en horas clase)
```
[Inject cada minuto] → [Detectar hora exacta MTY] → [Supabase: notificar_proxima_clase]
                                                       ↓
                                              [Enviar alerta a docentes]
```

**Horarios de alerta:** 7:27, 8:07, 8:47, 9:27, 10:27, 11:07, 11:47

### RPCs del Flow 5
- `vincular_maestro`
- `registrar_incidencia`
- `obtener_contacto_emergencia`
- `obtener_horario_maestro`
- `obtener_horario_grupo`
- `reporte_sabana_horarios`
- `buscar_expediente`
- `justificar_faltas_rango`
- `notificar_proxima_clase`

---

## 🔗 DIAGRAMA DE CONEXIÓN ENTRE FLUJOS

```
                    ┌─────────────────────────────────────┐
                    │         SUPABASE (PostgreSQL)        │
                    │   edkuesblaoafobezjkvs.supabase.co  │
                    └─────────────────────────────────────┘
                         ▲           ▲           ▲
                         │           │           │
              ┌──────────┘           │           └──────────┐
              │                      │                      │
    ┌─────────┴─────────┐ ┌─────────┴─────────┐ ┌─────────┴─────────┐
    │  Flow 1           │ │  Flow 2           │ │  Flow 3           │
    │  Bot Docente      │ │  Automatización   │ │  Dashboard Web    │
    │  (Telegram)       │ │  (Temp + Upload)  │ │  (UI Dashboard)   │
    └───────────────────┘ └───────────────────┘ └───────────────────┘
              ▲                                        ▲
              │                                        │
    ┌─────────┴─────────┐                   ┌─────────┴─────────┐
    │  Flow 5           │                   │  Flow 4           │
    │  Bot Docente v3   │                   │  Bot Padres       │
    │  (Zero Trust)     │                   │  (Telegram)       │
    └───────────────────┘                   └───────────────────┘
```

---

## 🔐 SEGURIDAD Y ACCESOS

### Sistema de Autenticación
1. **Login Web:** Maestro + PIN de 4 dígitos (vía Supabase RPC `validar_login`)
2. **Telegram Docente:** Lista blanca de chat IDs autorizados
3. **Telegram Docente v3:** Login vía `/login PIN` + `vincular_maestro`
4. **Panel Admin (Flow 2):** PIN 4107 para subir XML y calificaciones
5. **Incidencia:** PIN del maestro requerido para firmar

### Telegram Bots utilizados
| Bot | Username | Uso |
|-----|----------|-----|
| `55d65a9f4252c38d` | DJTBasistenciabot | Bot Docente (Flow 1) |
| `ece1eba468b73903` | SIAE_11_Padres_Bot | Bot Padres (Flow 4 + notificaciones) |
| `3bfa7eda31a7d7be` | DOCENTES SEC 11 BOT | Bot Docente v3 (Flow 5) |

---

## 📧 CORREOS ELECTRÓNICOS

### Configuración SMTP
- **Servidor:** smtp.gmail.com:465 (SSL)
- **Tipos de correos:**
  1. Aviso de inasistencia a padres (agrupado por familia)
  2. Aviso de incidencia disciplinaria
  3. Notificación de nuevo horario (a listas grupales + padres)
  4. Aviso de justificante aplicado

### Listas de distribución (Horarios)
- `grupo{N}.2526@secundaria11jtb.com` - Por grupo

---

## 📅 TEMPORIZADORES

| Timer | Intervalo | Función |
|-------|-----------|---------|
| `52e6668e9592ae2b` | Cada 120s | Revisar y enviar correos de faltas pendientes |
| `btn_cargar_manual` | Once (0.1s) | Cargar manual SIAE en RAM (para Gemini) |
| `reloj_inject` | Cada 60s | Reloj escolar (alertas 3 min antes de clase) |
| `carga_maestros_inject` | Once (0.1s) | Cargar lista de maestros al iniciar Dashboard |

---

## 🤖 GEMINI AI INTEGRATION

### Grupo: "Cerebro SIAE - Sec. 11 (Gemini Flash)"
```
[Inject: cargar manual] → [change: guardar en global.manual_siae]
[Inject: pregunta prueba] → [Preparar Consulta (Filtro Privacidad)]
                                ↓
                     [HTTP: Gemini API (gemini-2.5-flash)]
                                ↓
                     [Extraer respuesta] → [Debug]
```

**API Key:** `AIzaSyD_sTxIU-9JDugeSEycLkm5LMgplVoNoic`
**Modelo:** `gemini-2.5-flash`
**Temperatura:** 0.1 (mínima creatividad)
**Filtro de privacidad:** Elimina teléfono y correo antes de enviar a Gemini

---

## ⚠️ NOTAS IMPORTANTES

1. **Tokens Supabase visibles en el flujo:** Las API keys (anon key) están hardcodeadas en múltiples nodos http request
2. **Logo en base64** está en `ui_template` (ID `02d38a5ad47b1a1a`) - **saltado durante análisis**
3. **El flujo usa polling** para Telegram (no webhooks) - intervalos de 300ms
4. **Todos los bots apuntan a la misma DB Supabase**
5. **El bot v3 (bot_docente_v3) tiene máquina de estados** más avanzada que el Flow 1
