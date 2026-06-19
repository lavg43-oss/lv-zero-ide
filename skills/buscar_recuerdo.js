import { createClient } from '@supabase/supabase-js';

const description = 'Busca recuerdos en la memoria del sistema. USA EXCLUSIVAMENTE LV_SUPABASE_*. NUNCA uses SUPABASE_*.';

const parameters = {
    type: 'object',
    properties: {
        query: { type: 'string', description: 'Texto de búsqueda para encontrar recuerdos similares' },
        limit: { type: 'number', description: 'Número máximo de resultados (default: 5)' },
        threshold: { type: 'number', description: 'Umbral de similitud mínimo (0-1, default: 0.7)' }
    },
    required: ['query']
};

async function handler(params) {
    // Memory skills ONLY use LV_SUPABASE_* — never fall back to SUPABASE_*
    const supabaseUrl = process.env.LV_SUPABASE_URL;
    const supabaseKey = process.env.LV_SUPABASE_SERVICE_ROLE_KEY || process.env.LV_SUPABASE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
        return { error: 'Memoria no configurada. Configura LV_SUPABASE_URL y LV_SUPABASE_KEY en .env' };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const embedding = await generateEmbedding(params.query);
    const limit = params.limit || 5;
    const matchThreshold = params.threshold || 0.7;
    
    // Search using vector similarity
    const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: embedding,
        match_threshold: matchThreshold,
        match_count: limit
    });
    
    if (error) {
        // Fallback: text search if RPC not available
        const { data: fallbackData, error: fallbackError } = await supabase
            .from('memories')
            .select('*')
            .ilike('content', `%${params.query}%`)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (fallbackError) return { error: fallbackError.message };
        return { success: true, results: fallbackData, method: 'text_search' };
    }
    
    return { success: true, results: data, method: 'vector_search' };
}

async function generateEmbedding(text) {
    const hash = text.split('').reduce((acc, char) => ((acc * 31 + char.charCodeAt(0)) >>> 0), 0);
    return Array.from({ length: 128 }, (_, i) => Math.sin(hash * (i + 1)) * 0.5);
}

export default {
    name: 'buscar_recuerdo',
    description,
    parameters,
    handler
};
