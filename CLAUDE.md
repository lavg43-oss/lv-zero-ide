# LV-ZERO — Contexto Persistente

## 🗺️ Graphify Knowledge Graph

Este proyecto tiene un grafo de conocimiento completo en `graphify-out/` (3394 nodos, 4571 aristas, 229 comunidades).

### Comandos útiles

```bash
# Consulta semántica
graphify query "<pregunta>" --graph graphify-out/graph.json

# Explicar un nodo y sus conexiones
graphify explain "<nodo>" --graph graphify-out/graph.json

# Ruta más corta entre dos símbolos
graphify path "<A>" "<B>" --graph graphify-out/graph.json
```

### Contenido indexado
- Todo el código fuente de LV-ZERO (AST extract)
- Documentación oficial de DeepSeek V4 (10 URLs de api-docs.deepseek.com)
  - Modelos: deepseek-v4-flash y deepseek-v4-pro
  - Pricing, error codes, thinking mode, tool calls
  - KV cache, JSON mode, FIM completion, Anthropic API
- REGLAS_DEEPSEEK.md (referencia rápida en la raíz)

### Cuándo usarlo
- Antes de responder preguntas técnicas sobre DeepSeek
- Para entender relaciones entre código, archivos y configuraciones
- Para verificar información sin adivinar
