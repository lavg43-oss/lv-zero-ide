/**
 * nodered_expert — Skill Experta en Node-RED
 *
 * v1.0.1
 *   Convierte al agente en un especialista en Node-RED.
 *   Lee, analiza, modifica y construye flujos (flows.json).
 *   Entiende la estructura interna de nodos, wires, tabs y config nodes.
 *
 *   Formato Node-RED (flows.json):
 *     Array plano de objetos, cada uno es un nodo.
 *     Propiedades base de cada nodo:
 *       - id:     string único (ej: "a1b2c3d4.ef5678")
 *       - type:   tipo de nodo (inject, debug, function, http in, mqtt, etc.)
 *       - x, y:   coordenadas en el workspace
 *       - z:      id del tab (flow) al que pertenece
 *       - wires:  array de arrays, cada sub-array = outputs del nodo
 *                 cada elemento es un string con el id del nodo destino
 *       - Más propiedades según el type del nodo
 *
 *     Tipos comunes documentados en el handout de la skill.
 */

// ─── API Pública ───────────────────────────────────────────────────────

async function readFlowFile(filePath) {
  try {
    const fs = await import('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    const flow = JSON.parse(content);
    if (!Array.isArray(flow)) {
      return { success: false, error: 'El archivo no contiene un array válido de nodos Node-RED' };
    }
    return { success: true, data: flow, nodeCount: flow.length };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: false, error: `Archivo no encontrado: ${filePath}` };
    }
    if (err instanceof SyntaxError) {
      return { success: false, error: `Error de sintaxis JSON: ${err.message}` };
    }
    return { success: false, error: `Error leyendo archivo: ${err.message}` };
  }
}

async function writeFlowFile(filePath, flow) {
  try {
    const fs = await import('fs');
    fs.writeFileSync(filePath, JSON.stringify(flow, null, 2), 'utf-8');
    return { success: true, message: `Flujo guardado en ${filePath} (${flow.length} nodos)` };
  } catch (err) {
    return { success: false, error: `Error escribiendo archivo: ${err.message}` };
  }
}

function analyzeFlow(flow) {
  const tabs = flow.filter(n => n.type === 'tab').map(t => ({ id: t.id, label: t.label }));
  const byType = {};
  const connections = [];
  const orphans = [];

  for (const node of flow) {
    byType[node.type] = (byType[node.type] || 0) + 1;

    if (node.wires && Array.isArray(node.wires)) {
      for (let outputIdx = 0; outputIdx < node.wires.length; outputIdx++) {
        const targets = node.wires[outputIdx];
        if (Array.isArray(targets)) {
          for (const targetId of targets) {
            if (targetId) {
              connections.push({ from: node.id, fromType: node.type, output: outputIdx, to: targetId });
            }
          }
        }
      }
    }

    const isConfig = node.type.endsWith('-config');
    const isTab = node.type === 'tab';
    if (!isConfig && !isTab) {
      const hasOutputs = node.wires && Array.isArray(node.wires) && node.wires.some(w => Array.isArray(w) && w.length > 0);
      const isEndpoint = ['debug', 'http response', 'websocket out', 'mqtt out', 'udp out', 'tcp out', 'file out', 'watchdog'].includes(node.type);
      if (!hasOutputs && !isEndpoint) {
        orphans.push({ id: node.id, type: node.type, name: node.name || '' });
      }
    }
  }

  return { tabs, nodeTypes: byType, nodeCount: flow.length, connectionCount: connections.length, connections, orphans };
}

function findNodes(flow, criteria = {}) {
  let results = [...flow];
  if (criteria.type) results = results.filter(n => n.type === criteria.type);
  if (criteria.name) {
    const s = criteria.name.toLowerCase();
    results = results.filter(n => (n.name || '').toLowerCase().includes(s));
  }
  if (criteria.id) results = results.filter(n => n.id === criteria.id);
  if (criteria.tabId) results = results.filter(n => n.z === criteria.tabId);
  if (criteria.property && criteria.value !== undefined) results = results.filter(n => n[criteria.property] === criteria.value);
  return results;
}

function createNode(spec) {
  const id = generateNodeId();
  const node = {
    id, type: spec.type,
    z: spec.tabId || '',
    name: spec.props?.name || '',
    x: spec.x || 100, y: spec.y || 100,
    wires: spec.props?.wires || [],
  };
  if (spec.props) {
    for (const [key, value] of Object.entries(spec.props)) {
      if (!['name', 'wires'].includes(key)) node[key] = value;
    }
  }
  return node;
}

function generateNodeId() {
  const p1 = Math.random().toString(16).substring(2, 14);
  const p2 = Math.random().toString(16).substring(2, 6);
  return `${p1}.${p2}`;
}

function connectNodes(flow, fromId, toId, outputIndex = 0) {
  const fromNode = flow.find(n => n.id === fromId);
  const toNode = flow.find(n => n.id === toId);
  if (!fromNode) return { success: false, error: `Nodo origen "${fromId}" no encontrado` };
  if (!toNode) return { success: false, error: `Nodo destino "${toId}" no encontrado` };
  while (fromNode.wires.length <= outputIndex) fromNode.wires.push([]);
  fromNode.wires[outputIndex].push(toId);
  return { success: true, message: `Conectado ${fromId} → ${toId}` };
}

function disconnectNodes(flow, fromId, toId, outputIndex = 0) {
  const fromNode = flow.find(n => n.id === fromId);
  if (!fromNode) return { success: false, error: `Nodo origen "${fromId}" no encontrado` };
  if (fromNode.wires[outputIndex]) {
    fromNode.wires[outputIndex] = fromNode.wires[outputIndex].filter(id => id !== toId);
  }
  return { success: true, message: `Desconectado ${fromId} → ${toId}` };
}

function removeNode(flow, nodeId) {
  const idx = flow.findIndex(n => n.id === nodeId);
  if (idx === -1) return { success: false, error: `Nodo "${nodeId}" no encontrado` };
  for (const node of flow) {
    if (node.wires && Array.isArray(node.wires)) {
      for (let i = 0; i < node.wires.length; i++) {
        node.wires[i] = node.wires[i].filter(id => id !== nodeId);
      }
    }
  }
  flow.splice(idx, 1);
  return { success: true, message: `Nodo "${nodeId}" eliminado del flow` };
}

function createFlow(name, nodesSpec = []) {
  const tabId = generateNodeId();
  const tab = { id: tabId, type: 'tab', label: name, disabled: false, info: '' };
  const nodes = [tab];

  for (const spec of nodesSpec) {
    const node = createNode({ type: spec.type, tabId, x: spec.x || 100, y: spec.y || 100, props: spec.props || {} });
    // Asegurar wires inicializado
    if (!node.wires || node.wires.length === 0) node.wires = [[]];
    nodes.push(node);
    spec._nodeId = node.id;
  }

  // Resolver conexiones entre índices
  for (let i = 0; i < nodesSpec.length; i++) {
    const spec = nodesSpec[i];
    const fromId = spec._nodeId;
    if (spec.connections) {
      for (const conn of spec.connections) {
        let toId = conn.to;
        if (typeof toId === 'number') {
          const targetSpec = nodesSpec[toId];
          if (targetSpec && targetSpec._nodeId) toId = targetSpec._nodeId;
          else continue;
        }
        connectNodes(nodes, fromId, toId, conn.output || 0);
      }
    }
  }

  return { tab, nodes, tabId };
}

function validateFlow(flow) {
  const warnings = [];
  const nodeMap = new Map(flow.map(n => [n.id, n]));

  for (const node of flow) {
    if (node.wires && Array.isArray(node.wires)) {
      for (let oi = 0; oi < node.wires.length; oi++) {
        const targets = node.wires[oi];
        if (Array.isArray(targets)) {
          for (const targetId of targets) {
            if (!nodeMap.has(targetId)) {
              warnings.push({ severity: 'error', message: `Conexión a nodo inexistente: ${node.id}:${oi} → ${targetId}`, nodeId: node.id });
            }
          }
        }
      }
    }
    if (node.type === 'function' && (!node.func || node.func.trim() === '')) {
      warnings.push({ severity: 'warn', message: `Function node "${node.name || node.id}" está vacío`, nodeId: node.id });
    }
  }

  return warnings;
}

// ─── Export Tool ────────────────────────────────────────────────────────

export default {
  name: 'nodered_expert',
  description:
    'Experto en Node-RED: lee, analiza, modifica y construye flujos Node-RED (.json). ' +
    'Puede crear nodos, conectarlos por ID, eliminarlos, validar flujos enteros, y generar ' +
    'flows completos desde cero. Ideal para construir sistemas de automatización visual sin abrir el editor.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read_flow', 'write_flow', 'analyze', 'find_nodes', 'create_node', 'connect', 'disconnect', 'remove_node', 'create_flow', 'validate'],
        description: 'Acción: read_flow (lee archivo), write_flow (guarda), analyze (analiza), find_nodes (busca), create_node (crea 1 nodo), connect (conecta 2 nodos), disconnect (desconecta), remove_node (elimina), create_flow (crea flow completo), validate (valida).',
      },
      filePath: { type: 'string', description: 'Ruta completa al archivo flows.json (para read_flow / write_flow)' },
      flow: { type: 'array', description: 'Array de nodos Node-RED' },
      nodeSpec: { type: 'object', description: '{ type, tabId, x, y, props: {...} }' },
      criteria: { type: 'object', description: '{ type?, name?, tabId?, property?, value? }' },
      fromId: { type: 'string', description: 'ID nodo origen' },
      toId: { type: 'string', description: 'ID nodo destino' },
      nodeId: { type: 'string', description: 'ID nodo a eliminar' },
      name: { type: 'string', description: 'Nombre del flow (create_flow)' },
      nodesSpec: { type: 'array', description: 'Especificaciones [{ type, props, x, y, connections: [{ to: índice, output? }] }]' },
      outputIndex: { type: 'number', description: 'Índice de salida (default: 0)' },
    },
    required: ['action'],
  },
  handler: async (args) => {
    const { action } = args || {};
    try {
      switch (action) {
        case 'read_flow': return await readFlowFile(args.filePath);
        case 'write_flow': return await writeFlowFile(args.filePath, args.flow);
        case 'analyze':
          if (!args.flow) return { success: false, error: 'Se requiere "flow"' };
          return { success: true, data: analyzeFlow(args.flow) };
        case 'find_nodes':
          if (!args.flow) return { success: false, error: 'Se requiere "flow"' };
          return { success: true, data: findNodes(args.flow, args.criteria || {}) };
        case 'create_node':
          if (!args.nodeSpec) return { success: false, error: 'Se requiere "nodeSpec"' };
          return { success: true, data: createNode(args.nodeSpec) };
        case 'connect':
          if (!args.flow || !args.fromId || !args.toId) return { success: false, error: 'Requiere flow, fromId, toId' };
          return connectNodes(args.flow, args.fromId, args.toId, args.outputIndex || 0);
        case 'disconnect':
          if (!args.flow || !args.fromId || !args.toId) return { success: false, error: 'Requiere flow, fromId, toId' };
          return disconnectNodes(args.flow, args.fromId, args.toId, args.outputIndex || 0);
        case 'remove_node':
          if (!args.flow || !args.nodeId) return { success: false, error: 'Requiere flow y nodeId' };
          return removeNode(args.flow, args.nodeId);
        case 'create_flow':
          if (!args.name) return { success: false, error: 'Requiere "name"' };
          return { success: true, data: createFlow(args.name, args.nodesSpec || []) };
        case 'validate':
          if (!args.flow) return { success: false, error: 'Requiere "flow"' };
          return { success: true, data: validateFlow(args.flow) };
        default:
          return { success: false, error: `Acción desconocida: "${action}"` };
      }
    } catch (err) {
      return { success: false, error: `Error en nodered_expert: ${err.message}` };
    }
  },
};

// Exponer funciones para uso directo
export {
  readFlowFile, writeFlowFile, analyzeFlow, findNodes, createNode,
  connectNodes, disconnectNodes, removeNode, createFlow, validateFlow,
};
