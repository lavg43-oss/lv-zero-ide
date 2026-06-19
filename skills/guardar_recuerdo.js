import { createClient } from '@supabase/supabase-js';

const description = 'Guarda recuerdos en la memoria del sistema. USA EXCLUSIVAMENTE LV_SUPABASE_*. NUNCA uses SUPABASE_*.';

const parameters = {
    type: 'object',
    properties: {
        topic: { type: 'string', description: 'Tema o categoría del recuerdo (ej: "preferencias", "API keys", "notas")' },
        content: { type: 'string', description: 'Contenido del recuerdo a guardar' }
    },
    required: ['topic', 'content']
};

async function handler(params) {
    // Memory skills ONLY use LV_SUPABASE_* — never fall back to SUPABASE_*
    const supabaseUrl = process.env.LV_SUPABASE_URL;
    const supabaseKey = process.env.LV_SUPABASE_SERVICE_ROLE_KEY || process.env.LV_SUPABASE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
        return { error: 'Memoria no configurada. Configura LV_SUPABASE_URL y LV_SUPABASE_KEY en .env' };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Generate simple embedding (hash-based for now, or use an embedding model if available)
    const embedding = await generateEmbedding(params.content);
    
    const { data, error } = await supabase
        .from('memories')
        .insert({
            topic: params.topic,
            content: params.content,
            embedding,
            created_at: new Date().toISOString()
        })
        .select();
    
    if (error) return { error: error.message };
    return { success: true, data };
}

// Simple embedding generator (replace with real embedding model later)
async function generateEmbedding(text) {
    // Fallback: character-level features as simple embedding
    const hash = text.split('').reduce((acc, char) => ((acc * 31 + char.charCodeAt(0)) >>> 0), 0);
    return Array.from({ length: 128 }, (_, i) => Math.sin(hash * (i + 1)) * 0.5);
}

export default {
    name: 'guardar_recuerdo',
    description,
    parameters,
    handler
};
