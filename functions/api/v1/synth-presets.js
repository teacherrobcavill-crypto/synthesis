const BUILTIN_PRESETS = [
  {
    preset_id: 'builtin-16ft-bass',
    name: "16' Synth Bass",
    author: 'Teacher',
    category: 'bass',
    notes: '',
    is_builtin: true,
    params: {
      wave: 'sawtooth', octave: -1, detune: 6, sub: true,
      filterType: 'lowpass', cutoff: 44, q: 2.0, fenv: 1500,
      attack: 0.01, decay: 0.25, sustain: 0.5, release: 0.2
    }
  },
  {
    preset_id: 'builtin-80s-lead',
    name: '80s Arcade Square Lead',
    author: 'Teacher',
    category: 'melody',
    notes: '',
    is_builtin: true,
    params: {
      wave: 'square', octave: 0, detune: 5, sub: false,
      filterType: 'lowpass', cutoff: 72, q: 2.5, fenv: 1600,
      attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.16
    }
  },
  {
    preset_id: 'builtin-chiptune-arp',
    name: 'Chiptune Pluck',
    author: 'Teacher',
    category: 'harmony',
    notes: '',
    is_builtin: true,
    params: {
      wave: 'triangle', octave: 0, detune: 0, sub: false,
      filterType: 'lowpass', cutoff: 80, q: 1.5, fenv: 1200,
      attack: 0.005, decay: 0.18, sustain: 0.15, release: 0.12
    }
  },
  {
    preset_id: 'builtin-detuned-pad',
    name: 'Warm Detuned Pad',
    author: 'Teacher',
    category: 'harmony',
    notes: '',
    is_builtin: true,
    params: {
      wave: 'sawtooth', octave: 0, detune: 20, sub: false,
      filterType: 'lowpass', cutoff: 54, q: 1.5, fenv: 500,
      attack: 0.45, decay: 0.5, sustain: 0.8, release: 0.9
    }
  }
];

const ALLOWED_CATEGORIES = new Set(['melody', 'harmony', 'bass', 'fx']);

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const { results } = await env.DB.prepare(
      `SELECT preset_id, name, author, category, notes, is_builtin, params_json, created_at
       FROM synth_presets
       ORDER BY created_at DESC`
    ).all();

    const savedPresets = [];
    for (const row of results || []) {
      let params;
      try {
        params = JSON.parse(row.params_json);
      } catch {
        continue;
      }
      savedPresets.push({
        preset_id: row.preset_id,
        name: row.name,
        author: row.author,
        category: row.category,
        notes: row.notes || '',
        is_builtin: Boolean(row.is_builtin),
        params,
        created_at: row.created_at
      });
    }

    const existingIds = new Set(savedPresets.map(p => p.preset_id));
    const merged = [
      ...savedPresets,
      ...BUILTIN_PRESETS.filter(p => !existingIds.has(p.preset_id))
    ];

    return jsonResponse(merged, 200);
  } catch (err) {
    return jsonResponse({ error: 'Failed to load presets' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 50) : '';
  const author = typeof body?.author === 'string' ? body.author.trim().slice(0, 30) : '';
  const category = ALLOWED_CATEGORIES.has(body?.category) ? body.category : 'melody';
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 200) : '';
  const params = body?.params;

  if (!name || !author) {
    return jsonResponse({ error: 'Preset name and author are required' }, 400);
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return jsonResponse({ error: 'Valid synth params object is required' }, 400);
  }

  const paramsJson = JSON.stringify(params);
  if (paramsJson.length > 4096) {
    return jsonResponse({ error: 'Params payload too large' }, 400);
  }

  const presetId = `preset-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO synth_presets (preset_id, name, author, category, notes, is_builtin, params_json, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
      .bind(presetId, name, author, category, notes, paramsJson, createdAt)
      .run();

    return jsonResponse(
      {
        preset_id: presetId,
        name,
        author,
        category,
        notes,
        is_builtin: false,
        params,
        created_at: createdAt
      },
      201
    );
  } catch (err) {
    return jsonResponse({ error: 'Failed to save preset' }, 500);
  }
}
