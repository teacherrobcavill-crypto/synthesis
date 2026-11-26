const TEACHER_PIN = '01823';

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

let cachedModels = null;
let cachedAt = 0;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function ensureTable(db) {
  if (!db) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS workbook_submissions (
      id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      workbook_id TEXT NOT NULL DEFAULT 'guide1-year1',
      status TEXT NOT NULL DEFAULT 'progress',
      completion_pct INTEGER NOT NULL DEFAULT 0,
      checkpoints_passed INTEGER NOT NULL DEFAULT 0,
      practical_verified INTEGER NOT NULL DEFAULT 0,
      practical_total INTEGER NOT NULL DEFAULT 0,
      quiz_score INTEGER,
      answers_json TEXT NOT NULL,
      practical_json TEXT NOT NULL,
      ai_summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
}

async function listGeminiModels(apiKey) {
  if (cachedModels && Date.now() - cachedAt < 3600000) return cachedModels;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', {
      headers: { 'x-goog-api-key': apiKey }
    });
    if (res.ok) {
      const data = await res.json();
      const usable = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((n) => /flash|pro/.test(n) && !/image|tts|embed|live|audio|thinking|vision/.test(n));
      usable.sort((a, b) => (b.includes('flash') ? 1 : 0) - (a.includes('flash') ? 1 : 0) || b.localeCompare(a));
      if (usable.length) {
        cachedModels = usable.slice(0, 5);
        cachedAt = Date.now();
        return cachedModels;
      }
    }
  } catch (_) {}
  return FALLBACK_MODELS;
}

function buildWorkbookPrompt(payload) {
  const { studentName, answers, quizScore, practicalVerified, practicalTotal, checkpointsPassed } = payload;
  const formattedAnswers = Object.entries(answers || {})
    .filter(([, v]) => String(v || '').trim().length > 0)
    .map(([k, v]) => `- [${k}]: ${String(v).trim().slice(0, 400)}`)
    .join('\n');

  return `You are a Pearson Edexcel A-Level Music Technology (9MT0) senior examiner reviewing a Year 12 student's self-study workbook ("Subtractive Synthesis: First-Year Deep Foundations").
Student: "${studentName}"
Checkpoints passed: ${checkpointsPassed}/9 | Practical Synth Checks Verified: ${practicalVerified}/${practicalTotal} | 10-Q Quiz Score: ${quizScore ?? 'Not taken yet'}/10.

Student's written & practical listening responses:
${formattedAnswers || '(No written answers supplied)'}

Evaluate their understanding of key terms and functions (Signal Flow VCO->VCF->VCA, Harmonics/Golden Rule, Waveforms, Footage/Detune/Sub-Osc, LPF/HPF/BPF, Cutoff/Slope/Resonance, ADSR Sustain=Level, Filter Env, LFO Vibrato/Tremolo/Wobble, Preset Analysis, 8-Mark Synth Bass).

Return ONLY valid JSON with this exact schema:
{
  "overallSummary": "2-sentence plain-English teacher summary of this student's grasp of subtractive synthesis foundations.",
  "strengths": ["Short strength bullet 1", "Short strength bullet 2"],
  "misconceptions": [
    {
      "topic": "Short topic/term name",
      "issue": "1-sentence diagnosis of the specific misunderstanding or gap seen in their answers."
    }
  ],
  "examResponseBand": "Band 1-4 estimate (e.g. 'Band 3 (5-6/8)') with 1 concise sentence of feedback on their 8-mark synth bass draft."
}`;
}

async function callGeminiSummary(apiKey, payload) {
  const models = await listGeminiModels(apiKey);
  const prompt = buildWorkbookPrompt(payload);
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json'
            }
          })
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        return { ok: true, model, result: parsed };
      }
    } catch (_) {}
  }
  return { ok: false, model: 'fallback', result: null };
}

function buildFallbackSummary(payload) {
  const { quizScore, practicalVerified, practicalTotal, checkpointsPassed } = payload;
  const misconceptions = [];
  if (typeof quizScore === 'number' && quizScore < 8) {
    misconceptions.push({
      topic: 'Terminology & Core Concepts',
      issue: `Scored ${quizScore}/10 on the mastery quiz — review missed explanations and check Sustain (level vs. time), LPF slope (dB/oct), and LFO destinations.`
    });
  }
  if (practicalVerified < practicalTotal) {
    misconceptions.push({
      topic: 'Practical Synth Verification',
      issue: `Completed ${practicalVerified}/${practicalTotal} live synth lab actions — encourage completing all hands-on listening checks.`
    });
  }
  return {
    overallSummary: `Workbook saved (${checkpointsPassed}/9 checkpoints, ${practicalVerified}/${practicalTotal} practical checks, quiz ${quizScore ?? 'N/A'}/10). Ready for teacher inspection.`,
    strengths: ['Completed structured self-study responses in the Year 1 Foundations Workbook.'],
    misconceptions,
    examResponseBand: 'Saved for manual teacher review (AI summary unavailable or progress-only save).'
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pin = (url.searchParams.get('pin') || '').trim();
  if (pin !== TEACHER_PIN) {
    return jsonResponse({ error: 'Valid Teacher PIN required' }, 403);
  }

  try {
    await ensureTable(env.DB);
    const { results } = await env.DB.prepare(`
      SELECT id, student_name, status, completion_pct, checkpoints_passed,
             practical_verified, practical_total, quiz_score,
             answers_json, practical_json, ai_summary_json, updated_at, created_at
      FROM workbook_submissions
      WHERE workbook_id = 'guide1-year1'
      ORDER BY updated_at DESC
      LIMIT 100
    `).all();

    const submissions = (results || []).map((row) => {
      let answers = {};
      let practical = {};
      let aiSummary = {};
      try { answers = JSON.parse(row.answers_json); } catch (_) {}
      try { practical = JSON.parse(row.practical_json); } catch (_) {}
      try { aiSummary = JSON.parse(row.ai_summary_json); } catch (_) {}
      return {
        id: row.id,
        studentName: row.student_name,
        status: row.status,
        completionPct: row.completion_pct,
        checkpointsPassed: row.checkpoints_passed,
        practicalVerified: row.practical_verified,
        practicalTotal: row.practical_total,
        quizScore: row.quiz_score,
        answers,
        practical,
        aiSummary,
        updatedAt: row.updated_at,
        createdAt: row.created_at
      };
    });

    return jsonResponse({ submissions }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Failed to load workbook reports' }, 500);
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

  const studentName = typeof body?.studentName === 'string' ? body.studentName.trim().slice(0, 80) : '';
  if (!studentName) {
    return jsonResponse({ error: 'Student name is required' }, 400);
  }

  const mode = body?.mode === 'final' ? 'final' : 'progress';
  const completionPct = Math.max(0, Math.min(100, parseInt(body?.completionPct, 10) || 0));
  const checkpointsPassed = Math.max(0, Math.min(9, parseInt(body?.checkpointsPassed, 10) || 0));
  const practicalVerified = Math.max(0, parseInt(body?.practicalVerified, 10) || 0);
  const practicalTotal = Math.max(0, parseInt(body?.practicalTotal, 10) || 0);
  const quizScore = body?.quizScore != null ? Math.max(0, Math.min(10, parseInt(body.quizScore, 10) || 0)) : null;
  const answers = body?.answers && typeof body.answers === 'object' ? body.answers : {};
  const practical = body?.practical && typeof body.practical === 'object' ? body.practical : {};

  let aiUsed = false;
  let aiSummary = buildFallbackSummary({ quizScore, practicalVerified, practicalTotal, checkpointsPassed });

  if (mode === 'final' && env.GEMINI_API_KEY) {
    const aiRes = await callGeminiSummary(env.GEMINI_API_KEY, {
      studentName,
      answers,
      quizScore,
      practicalVerified,
      practicalTotal,
      checkpointsPassed
    });
    if (aiRes.ok && aiRes.result) {
      aiUsed = true;
      aiSummary = aiRes.result;
    }
  }

  const now = new Date().toISOString();
  const normalizedId = 'wb-y1-' + studentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

  try {
    await ensureTable(env.DB);
    await env.DB.prepare(`
      INSERT INTO workbook_submissions
        (id, student_name, workbook_id, status, completion_pct, checkpoints_passed,
         practical_verified, practical_total, quiz_score, answers_json, practical_json,
         ai_summary_json, updated_at, created_at)
      VALUES (?, ?, 'guide1-year1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        student_name = excluded.student_name,
        status = CASE WHEN workbook_submissions.status = 'final' THEN 'final' ELSE excluded.status END,
        completion_pct = excluded.completion_pct,
        checkpoints_passed = excluded.checkpoints_passed,
        practical_verified = excluded.practical_verified,
        practical_total = excluded.practical_total,
        quiz_score = COALESCE(excluded.quiz_score, workbook_submissions.quiz_score),
        answers_json = excluded.answers_json,
        practical_json = excluded.practical_json,
        ai_summary_json = CASE WHEN excluded.status = 'final' THEN excluded.ai_summary_json ELSE workbook_submissions.ai_summary_json END,
        updated_at = excluded.updated_at
    `).bind(
      normalizedId,
      studentName,
      mode,
      completionPct,
      checkpointsPassed,
      practicalVerified,
      practicalTotal,
      quizScore,
      JSON.stringify(answers),
      JSON.stringify(practical),
      JSON.stringify(aiSummary),
      now,
      now
    ).run();
  } catch (err) {
    return jsonResponse({ error: 'Database write failed: ' + err.message }, 500);
  }

  return jsonResponse({
    ok: true,
    id: normalizedId,
    studentName,
    status: mode,
    aiUsed,
    aiSummary,
    updatedAt: now
  }, 200);
}
