/**
 * ─── Discovery Agent for lv-zero ──────────────────────────────────────────
 *
 * "Nivel Cero" — Para usuarios sin conocimientos de programación.
 *
 * Cuando un usuario da un prompt vago (ej. "hazme un clon de Facebook"),
 * este agente realiza una entrevista estructurada con preguntas de opción
 * múltiple para acotar el alcance antes de pasar al Sprint Pipeline.
 *
 * Fases de la entrevista:
 *   1. Concepto — ¿Qué quieres construir?
 *   2. Alcance — ¿Qué funcionalidades esenciales necesita?
 *   3. Diseño — ¿Colores, estilo, logo?
 *   4. Datos — ¿Guardar información? ¿En dónde?
 *   5. Usuarios — ¿Quién va a usar esto?
 *   6. Publicación — ¿Solo web? ¿App móvil?
 *
 * v1.0 — June 2026
 *
 * @module discovery_agent
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Question Bank
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} Question
 * @property {string} id - Unique question ID
 * @property {string} phase - Phase name (concepto, alcance, diseño, datos, usuarios, publicacion)
 * @property {string} question - The question text
 * @property {{ text: string, value: string }[]} options - Multiple choice options
 * @property {boolean} [required] - Whether this question is required
 */

/** @type {Question[]} */
const QUESTIONS = [
  // ── Fase 1: Concepto ──────────────────────────────────────────────────
  {
    id: "app_name",
    phase: "concepto",
    question: "¿Qué nombre quieres para tu proyecto?",
    options: [
      { text: "Déjame ponerle nombre después", value: "pending" },
    ],
    required: false,
  },
  {
    id: "app_type",
    phase: "concepto",
    question: "¿Qué tipo de aplicación quieres crear?",
    options: [
      { text: "🌐 Página web informativa (como un portafolio o sitio de negocio)", value: "website" },
      { text: "🛒 Tienda en línea / E-commerce", value: "ecommerce" },
      { text: "📱 Aplicación web con usuarios y login", value: "webapp" },
      { text: "📊 Dashboard / Panel de administración", value: "dashboard" },
      { text: "📝 Blog / Sistema de contenido", value: "blog" },
      { text: "🔧 Herramienta / Utilidad específica", value: "tool" },
      { text: "🎨 Landing page / Página promocional", value: "landing" },
      { text: "🤔 No estoy seguro, ayúdame a decidir", value: "unsure" },
    ],
    required: true,
  },
  {
    id: "app_description",
    phase: "concepto",
    question: "En una frase, ¿qué hace tu aplicación? (Ej: 'Una página donde la gente pueda subir fotos de sus mascotas')",
    options: [
      { text: "Déjame explicarlo en el chat", value: "chat" },
    ],
    required: true,
  },

  // ── Fase 2: Alcance ───────────────────────────────────────────────────
  {
    id: "features",
    phase: "alcance",
    question: "¿Qué funcionalidades necesita tu aplicación? (Selecciona las más importantes)",
    options: [
      { text: "📝 Formulario de contacto", value: "contact_form" },
      { text: "🔐 Registro e inicio de sesión", value: "auth" },
      { text: "💳 Pagos en línea", value: "payments" },
      { text: "📧 Notificaciones por correo", value: "email" },
      { text: "🔍 Búsqueda de contenido", value: "search" },
      { text: "📊 Panel de estadísticas", value: "analytics" },
      { text: "💬 Chat en vivo", value: "chat" },
      { text: "📱 Diseño responsive (se ve bien en celular)", value: "responsive" },
      { text: "🌍 Múltiples idiomas", value: "i18n" },
      { text: "📄 Subida de archivos/imágenes", value: "uploads" },
    ],
    required: false,
  },
  {
    id: "timeline",
    phase: "alcance",
    question: "¿Con qué urgencia necesitas esto?",
    options: [
      { text: "🔥 Lo necesito ayer (lo básico funcionando)", value: "urgent" },
      { text: "📅 Esta semana (puedo esperar unos días)", value: "week" },
      { text: "📆 Este mes (tómate tu tiempo)", value: "month" },
      { text: "🧘 Sin prisa, que quede bien", value: "no_rush" },
    ],
    required: true,
  },

  // ── Fase 3: Diseño ────────────────────────────────────────────────────
  {
    id: "design_style",
    phase: "diseño",
    question: "¿Qué estilo visual prefieres?",
    options: [
      { text: "✨ Moderno y minimalista (como Apple)", value: "modern" },
      { text: "🎨 Colorido y divertido", value: "colorful" },
      { text: "🏢 Corporativo / Profesional", value: "corporate" },
      { text: "🌿 Natural / Orgánico", value: "natural" },
      { text: "🕹️ Tú decides, confío en tu criterio", value: "defer" },
    ],
    required: false,
  },
  {
    id: "colors",
    phase: "diseño",
    question: "¿Tienes colores o logo definidos?",
    options: [
      { text: "🎯 Sí, tengo colores específicos", value: "specific" },
      { text: "🌈 No, pero dime qué colores me recomiendas", value: "recommend" },
      { text: "🤷 No me importa, lo que quede bien", value: "defer" },
    ],
    required: false,
  },

  // ── Fase 4: Datos ─────────────────────────────────────────────────────
  {
    id: "data_storage",
    phase: "datos",
    question: "¿Necesitas guardar información (usuarios, productos, etc.)?",
    options: [
      { text: "💾 Sí, necesito base de datos", value: "database" },
      { text: "📄 Solo archivos estáticos (no guardo datos)", value: "static" },
      { text: "🔗 Ya tengo una API o base de datos existente", value: "existing" },
      { text: "🤔 No lo sé", value: "unsure" },
    ],
    required: true,
  },

  // ── Fase 5: Usuarios ──────────────────────────────────────────────────
  {
    id: "audience",
    phase: "usuarios",
    question: "¿Quién va a usar tu aplicación?",
    options: [
      { text: "👤 Solo yo (uso personal)", value: "personal" },
      { text: "👥 Amigos y familia", value: "friends" },
      { text: "🏢 Mi empresa / equipo de trabajo", value: "business" },
      { text: "🌎 El público en general", value: "public" },
    ],
    required: true,
  },

  // ── Fase 6: Publicación ───────────────────────────────────────────────
  {
    id: "publish",
    phase: "publicacion",
    question: "¿Quieres publicar tu aplicación en internet?",
    options: [
      { text: "🌐 Sí, en internet (Cloudflare Pages gratis)", value: "cloudflare" },
      { text: "💻 Solo en mi computadora por ahora", value: "local" },
      { text: "🔗 Ya tengo dominio y servidor", value: "existing" },
      { text: "🤔 ¿Eso cuesta? (Spoiler: Cloudflare Pages es GRATIS)", value: "cost_question" },
    ],
    required: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Discovery Agent
// ═══════════════════════════════════════════════════════════════════════════════

export class DiscoveryAgent {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this._logger = options.logger || console;
    this._answers = {};
    this._currentQuestionIndex = 0;
    this._phases = ["concepto", "alcance", "diseño", "datos", "usuarios", "publicacion"];
    this._currentPhaseIndex = 0;
    this._completed = false;
  }

  // ─── Properties ────────────────────────────────────────────────────────

  /** @returns {boolean} */
  get isComplete() {
    return this._completed;
  }

  /** @returns {object} */
  get answers() {
    return { ...this._answers };
  }

  /** @returns {number} Total number of questions */
  get totalQuestions() {
    return QUESTIONS.length;
  }

  /** @returns {number} Number of answered questions */
  get answeredCount() {
    return Object.keys(this._answers).length;
  }

  /** @returns {number} Progress percentage (0-100) */
  get progress() {
    return Math.round((this.answeredCount / this.totalQuestions) * 100);
  }

  /** @returns {string} Current phase name */
  get currentPhase() {
    return this._phases[this._currentPhaseIndex] || "completado";
  }

  // ─── Interview Flow ────────────────────────────────────────────────────

  /**
   * Determines if a user input needs the Discovery interview.
   * Returns true if the input is vague, short, or contains trigger words.
   *
   * @param {string} userInput - The user's message
   * @returns {boolean}
   */
  static needsDiscovery(userInput) {
    if (!userInput || userInput.length < 20) return true;

    const triggerWords = [
      "clon", "clone", "copia", "copy",
      "hazme", "creame", "make me", "build me",
      "una app", "un sistema", "un programa",
      "algo que", "cosa que",
      "no sé", "no se",
      "ayuda", "help",
    ];

    const lower = userInput.toLowerCase();
    for (const word of triggerWords) {
      if (lower.includes(word)) return true;
    }

    return false;
  }

  /**
   * Starts the discovery interview.
   * Returns the first question to ask the user.
   *
   * @returns {{ question: string, options: { text: string, value: string }[], phase: string, progress: number }}
   */
  start() {
    this._answers = {};
    this._currentQuestionIndex = 0;
    this._currentPhaseIndex = 0;
    this._completed = false;

    return this._getCurrentQuestion();
  }

  /**
   * Submits an answer and returns the next question (or completion).
   *
   * @param {string} questionId - The question ID being answered
   * @param {string|string[]} value - The answer value(s)
   * @returns {{
   *   completed: boolean,
   *   question?: { id: string, text: string, options: { text: string, value: string }[] },
   *   phase?: string,
   *   progress?: number,
   *   summary?: object
   * }}
   */
  answer(questionId, value) {
    // Store the answer
    this._answers[questionId] = value;
    this._currentQuestionIndex++;

    // Check if we've completed all questions
    if (this._currentQuestionIndex >= QUESTIONS.length) {
      this._completed = true;
      return {
        completed: true,
        summary: this.generateSummary(),
      };
    }

    // Update phase index
    const nextQuestion = QUESTIONS[this._currentQuestionIndex];
    const nextPhaseIndex = this._phases.indexOf(nextQuestion.phase);
    if (nextPhaseIndex > this._currentPhaseIndex) {
      this._currentPhaseIndex = nextPhaseIndex;
    }

    return {
      completed: false,
      question: {
        id: nextQuestion.id,
        text: nextQuestion.question,
        options: nextQuestion.options,
      },
      phase: nextQuestion.phase,
      progress: this.progress,
    };
  }

  /**
   * Generates a structured project summary from the answers.
   *
   * @returns {object} Project specification
   */
  generateSummary() {
    const answers = this._answers;

    return {
      projectName: answers.app_name === "pending" ? null : answers.app_name,
      type: answers.app_type || "unsure",
      description: answers.app_description || "",
      features: Array.isArray(answers.features) ? answers.features :
                (answers.features ? [answers.features] : []),
      timeline: answers.timeline || "no_rush",
      designStyle: answers.design_style || "defer",
      hasColors: answers.colors || "defer",
      dataStorage: answers.data_storage || "unsure",
      audience: answers.audience || "personal",
      publishTarget: answers.publish || "local",
    };
  }

  /**
   * Generates a human-readable PRD (Product Requirements Document) from the answers.
   *
   * @returns {string} Markdown PRD
   */
  generatePRD() {
    const s = this.generateSummary();
    const lines = [
      `# 📋 PRD: ${s.projectName || s.type || "Nuevo Proyecto"}`,
      ``,
      `## 📝 Descripción`,
      `${s.description || "Sin descripción"}`,
      ``,
      `## 🎯 Tipo`,
      `${this._translateType(s.type)}`,
      ``,
      `## ⚡ Funcionalidades`,
    ];

    if (s.features.length > 0) {
      for (const f of s.features) {
        lines.push(`- ${this._translateFeature(f)}`);
      }
    } else {
      lines.push(`- (Por definir durante el desarrollo)`);
    }

    lines.push(
      ``,
      `## ⏱ Timeline`,
      `${this._translateTimeline(s.timeline)}`,
      ``,
      `## 🎨 Diseño`,
      `${this._translateDesign(s.designStyle)}`,
      ``,
      `## 💾 Datos`,
      `${this._translateData(s.dataStorage)}`,
      ``,
      `## 👥 Usuarios`,
      `${this._translateAudience(s.audience)}`,
      ``,
      `## 🌐 Publicación`,
      `${this._translatePublish(s.publishTarget)}`,
      ``,
      `---`,
      `*Generado automáticamente por el Discovery Agent de lv-zero*`,
    );

    return lines.join("\n");
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  /**
   * Returns the current question object.
   * @returns {{ question: string, options: { text: string, value: string }[], phase: string, progress: number }}
   */
  _getCurrentQuestion() {
    if (this._currentQuestionIndex >= QUESTIONS.length) {
      this._completed = true;
      return null;
    }

    const q = QUESTIONS[this._currentQuestionIndex];
    return {
      question: q.question,
      options: q.options,
      phase: q.phase,
      progress: this.progress,
    };
  }

  _translateType(type) {
    const map = {
      website: "🌐 Sitio web informativo",
      ecommerce: "🛒 Tienda en línea",
      webapp: "📱 Aplicación web con usuarios",
      dashboard: "📊 Dashboard / Panel",
      blog: "📝 Blog / CMS",
      tool: "🔧 Herramienta específica",
      landing: "🎨 Landing page",
      unsure: "🤔 Por definir",
    };
    return map[type] || type;
  }

  _translateFeature(feature) {
    const map = {
      contact_form: "Formulario de contacto",
      auth: "Registro e inicio de sesión",
      payments: "Pagos en línea",
      email: "Notificaciones por correo",
      search: "Búsqueda de contenido",
      analytics: "Panel de estadísticas",
      chat: "Chat en vivo",
      responsive: "Diseño responsive",
      i18n: "Múltiples idiomas",
      uploads: "Subida de archivos",
    };
    return map[feature] || feature;
  }

  _translateTimeline(timeline) {
    const map = {
      urgent: "🔥 Urgente — lo básico funcionando cuanto antes",
      week: "📅 Esta semana",
      month: "📆 Este mes",
      no_rush: "🧘 Sin prisa, con calidad",
    };
    return map[timeline] || timeline;
  }

  _translateDesign(style) {
    const map = {
      modern: "Moderno y minimalista",
      colorful: "Colorido y divertido",
      corporate: "Corporativo / Profesional",
      natural: "Natural / Orgánico",
      defer: "Lo decide el agente",
    };
    return map[style] || style;
  }

  _translateData(storage) {
    const map = {
      database: "Base de datos",
      static: "Solo archivos estáticos",
      existing: "API/DB existente",
      unsure: "Por definir",
    };
    return map[storage] || storage;
  }

  _translateAudience(audience) {
    const map = {
      personal: "Uso personal",
      friends: "Amigos y familia",
      business: "Empresa / Equipo",
      public: "Público en general",
    };
    return map[audience] || audience;
  }

  _translatePublish(publish) {
    const map = {
      cloudflare: "Internet (Cloudflare Pages — GRATIS)",
      local: "Solo local",
      existing: "Dominio/servidor existente",
      cost_question: "Internet (Cloudflare Pages — GRATIS)",
    };
    return map[publish] || publish;
  }
}
