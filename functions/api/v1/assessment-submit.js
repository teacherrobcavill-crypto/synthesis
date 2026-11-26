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

function buildGradingPrompt(payload) {
  const { studentName, sectionA, sectionB, sectionC } = payload;
  return `You are a Pearson Edexcel A-Level Music Technology (9MT0) senior examiner and synthesis tutor.
A student named "${studentName}" has just completed the "Basic Synthesis Assessment (Guides 1-3)".

Here are their submitted answers:

=== SECTION A (Auto-marked: ${sectionA.score}/10) ===
- Q1 (Waveforms & Golden Rule): Selected "${sectionA.q1 || 'None'}" (Correct: A - Sawtooth has all odd & even harmonics; sine has fundamental only)
- Q2 (Filter Resonance Chain): ${JSON.stringify(sectionA.q2 || [])} (Correct: ["Increase VCF Resonance (Q)", "Boosts a narrow frequency band right at the cutoff point", "Adds nasal punch or squelchy acid emphasis"])
- Q3 (Modular ADSR -> VCA): Selected "${sectionA.q3 || 'None'}" (Correct: B - VCO runs continuously; Gate-triggered ADSR opens/closes VCA)
- Q4 (LFO -> VCO Pitch Chain): ${JSON.stringify(sectionA.q4 || [])} (Correct: ["Patch 5 Hz LFO -> VCO pitch CV", "Cyclically modulates oscillator frequency below 20 Hz", "Produces expressive pitch vibrato on sustained notes"])
- Q5 (1970 Minimoog vs DAW): Selected "${sectionA.q5 || 'None'}" (Correct: C - Normalled cable-free path, monophonic, no preset memory, analogue tuning drift)

=== SECTION B (12 marks total: Q6=4, Q7=4, Q8=4) ===
- Q6 (1970s Analogue Synth Bass Table):
  * VCO Waveform & Range: Setting="${sectionB.q6?.vcoSetting || ''}" | Reason="${sectionB.q6?.vcoReason || ''}"
  * VCF Slope (dB/oct): Setting="${sectionB.q6?.slopeSetting || ''}" | Reason="${sectionB.q6?.slopeReason || ''}"
  * VCF Cutoff Frequency: Setting="${sectionB.q6?.cutoffSetting || ''}" | Reason="${sectionB.q6?.cutoffReason || ''}"
  * VCF Resonance (Q): Setting="${sectionB.q6?.resSetting || ''}" | Reason="${sectionB.q6?.resReason || ''}"
  (Mark scheme: Sawtooth/Square at 16' (1); 24 dB/oct ladder slope steep roll-off (1); low cutoff 250-650 Hz (1); moderate Q 4-8 narrow peak at cutoff for nasal punch (1))

- Q7(a) Audio Signals vs Control Voltages/Gates (2 marks):
  Student wrote: "${sectionB.q7a || ''}"
  (Mark scheme: Audio signals carry audible sound VCO->VCF->VCA (1); CV/Gates are non-audible automation voltages controlling pitch, cutoff, or VCA loudness (1))

- Q7(b) 1V/Octave & Gate destination (2 marks):
  Student wrote: "${sectionB.q7b || ''}"
  (Mark scheme: +1.00V doubles frequency / raises pitch by 1 octave (1); ADSR Envelope Generator receives Gate pulse to shape VCA volume (1))

- Q8(a) LFO Destinations (2 marks):
  * LFO -> VCO Pitch: "${sectionB.q8a?.pitch || ''}" (Vibrato)
  * LFO -> VCA Amplitude: "${sectionB.q8a?.amp || ''}" (Tremolo)
  * LFO -> VCF Cutoff: "${sectionB.q8a?.cutoff || ''}" (Filter Wobble / Auto-wah)

- Q8(b) Why separate VCA & VCF Envelopes (2 marks):
  Student wrote: "${sectionB.q8b || ''}"
  (Mark scheme: Lets loudness and timbral brightness evolve independently (1) + valid musical example like fast filter decay pluck over sustained bass or slow brass bloom (1))

=== SECTION C (8 marks: Q9 Extended Evaluation AO3/AO4) ===
Student wrote: "${sectionC.q9 || ''}"
(Band 4 7-8 marks covers: Minimoog normalled 3 VCO->Mixer->24dB Ladder->VCA + Osc 3 LO/Pitch-Mod wheels + genre impact; Hardware pros/cons incl. drift/A-440/paper patch sheets/monophony; DAW plugin pros/cons incl. recall/instances/automation/CPU; Expanded features: polyphony, portamento, arpeggiation, pitch bend range, unison.)

Return ONLY valid JSON matching this exact structure:
{
  "q6Score": 0,
  "q7Score": 0,
  "q8Score": 0,
  "q9Score": 0,
  "questionFeedback": {
    "q6": "1-2 concise sentences referencing what the student wrote.",
    "q7": "1-2 concise sentences referencing what the student wrote.",
    "q8": "1-2 concise sentences referencing what the student wrote.",
    "q9": "2-3 concise sentences giving Band/AO3-AO4 feedback on what they wrote and what to add."
  },
  "misconceptions": [
    {
      "topic": "Short topic label",
      "misconceptionNote": "Single-sentence summary of the specific gap or misconception observed.",
      "guideUrl": "/guide1"
    }
  ],
  "followUpQuestions": [
    {
      "topic": "Short topic label",
      "question": "Bespoke follow-up question targeting this student's specific gap or next step.",
      "hint": "1-sentence Socratic hint.",
      "modelAnswer": "Concise 1-2 sentence model answer.",
      "guideUrl": "/guide2"
    }
  ],
  "revisionNotes": [
    {
      "title": "Short revision focus title",
      "note": "2-sentence concise revision note tailored to what the student missed.",
      "guideUrl": "/guide3"
    }
  ]
}

Rules:
- q6Score, q7Score, q8Score must be integers 0..4; q9Score must be integer 0..8.
- Provide 2-4 misconceptions (or if they scored near full marks, 1 stretch misconception/refinement note).
- Provide exactly 3 bespoke followUpQuestions and 2-3 tailored revisionNotes.
- guideUrl must be one of "/guide1", "/guide2", or "/guide3".`;
}

async function callGeminiGrade(apiKey, payload) {
  const prompt = buildGradingPrompt(payload);
  const models = await listGeminiModels(apiKey);
  let lastError = 'No Gemini model responded';

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
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        lastError = `[${model}] ${err?.error?.message || `HTTP ${res.status}`}`;
        continue;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      const parsed = JSON.parse(rawText);
      return { ok: true, model, result: parsed };
    } catch (e) {
      lastError = e.message;
    }
  }
  return { ok: false, error: lastError };
}

function buildFallbackResult(payload) {
  const { sectionA } = payload;
  const misconceptions = [];
  if (sectionA.q1 !== 'A') {
    misconceptions.push({
      topic: 'Waveforms & Harmonics',
      misconceptionNote: 'Needs review on why sawtooth waves supply all harmonics while sine waves lack upper overtones for filtering.',
      guideUrl: '/guide1'
    });
  }
  if (sectionA.q3 !== 'B') {
    misconceptions.push({
      topic: 'Modular Audio vs. CV',
      misconceptionNote: 'Needs review on why a Gate-triggered ADSR control voltage is required to open and close the VCA.',
      guideUrl: '/guide2'
    });
  }
  if (sectionA.q5 !== 'C') {
    misconceptions.push({
      topic: 'Minimoog & DAW Evolution',
      misconceptionNote: 'Needs review on the 1970 Minimoog normalled signal path versus its monophonic, zero-preset hardware limits.',
      guideUrl: '/guide3'
    });
  }
  if (misconceptions.length === 0) {
    misconceptions.push({
      topic: 'Extended Evaluation Depth',
      misconceptionNote: 'Strong Section A accuracy — deepen AO4 evaluation of hardware drift and DAW plugin workflow trade-offs.',
      guideUrl: '/guide3'
    });
  }

  return {
    q6Score: 0,
    q7Score: 0,
    q8Score: 0,
    q9Score: 0,
    pendingAiReview: true,
    questionFeedback: {
      q6: 'Saved for teacher review (AI marker temporarily unavailable). Check the Teacher Mark Scheme above to self-assess.',
      q7: 'Saved for teacher review (AI marker temporarily unavailable). Check the Teacher Mark Scheme above to self-assess.',
      q8: 'Saved for teacher review (AI marker temporarily unavailable). Check the Teacher Mark Scheme above to self-assess.',
      q9: 'Saved for teacher review (AI marker temporarily unavailable). Compare your response against the Band 4 pillars.'
    },
    misconceptions,
    followUpQuestions: [
      {
        topic: 'Harmonic Richness (Guide 1)',
        question: 'Why does a 24 dB/oct low-pass filter noticeably darken a sawtooth wave at 600 Hz, yet barely change a sine wave at the same frequency?',
        hint: 'Think about what upper frequencies exist above 600 Hz in each waveform.',
        modelAnswer: 'A sawtooth contains all odd and even harmonics above 600 Hz for the filter to attenuate, whereas a sine wave has only the fundamental frequency.',
        guideUrl: '/guide1'
      },
      {
        topic: 'Dual Envelopes (Guide 2)',
        question: 'How would you set Filter Decay and VCA Sustain so a synth bass has a bright percussive attack while holding a warm sub-bass note?',
        hint: 'Use a fast Filter Decay with low Filter Sustain, paired with high VCA Sustain.',
        modelAnswer: 'Set a fast Filter Decay (150–250 ms) and low Filter Sustain so brightness snaps shut quickly, while keeping VCA Sustain high so the fundamental keeps ringing.',
        guideUrl: '/guide2'
      },
      {
        topic: 'Minimoog vs. DAW (Guide 3)',
        question: 'Name two workflow problems of a 1970 Minimoog Model D that modern DAW plugin recreations solve.',
        hint: 'Consider patch recall, polyphony, tuning drift, and automation.',
        modelAnswer: 'DAW plugins provide instant preset recall (replacing paper patch sheets) and sample-accurate tempo-synced automation plus polyphony and rock-solid tuning.',
        guideUrl: '/guide3'
      }
    ],
    revisionNotes: [
      {
        title: 'Core Subtractive Signal Flow',
        note: 'Always trace audio from VCO (rich waveform) -> VCF (24 dB/oct low-pass cutoff + resonance) -> VCA (final loudness). Control Voltages and Gates automate parameters without entering the audio path.',
        guideUrl: '/guide1'
      }
    ]
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
    const { results } = await env.DB.prepare(
      `SELECT id, student_name, assess_date, section_a_score, section_b_score, section_c_score, total_score, answers_json, ai_result_json, misconceptions_json, created_at
       FROM assessment_submissions
       ORDER BY created_at DESC
       LIMIT 50`
    ).all();

    const submissions = (results || []).map((row) => {
      let answers = {};
      let aiResult = {};
      let misconceptions = [];
      try { answers = JSON.parse(row.answers_json); } catch (_) {}
      try { aiResult = JSON.parse(row.ai_result_json); } catch (_) {}
      try { misconceptions = JSON.parse(row.misconceptions_json); } catch (_) {}
      return {
        id: row.id,
        studentName: row.student_name,
        assessDate: row.assess_date,
        sectionAScore: row.section_a_score,
        sectionBScore: row.section_b_score,
        sectionCScore: row.section_c_score,
        totalScore: row.total_score,
        answers,
        aiResult,
        misconceptions,
        createdAt: row.created_at
      };
    });

    return jsonResponse({ submissions }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Failed to load submissions' }, 500);
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
  const assessDate = typeof body?.assessDate === 'string' ? body.assessDate.trim().slice(0, 20) : '';
  if (!studentName) {
    return jsonResponse({ error: 'Student name is required' }, 400);
  }

  const sectionA = body?.sectionA || {};
  const sectionB = body?.sectionB || {};
  const sectionC = body?.sectionC || {};
  const sectionAScore = Math.max(0, Math.min(10, parseInt(sectionA.score, 10) || 0));

  let aiUsed = false;
  let modelName = 'fallback';
  let result;

  if (env.GEMINI_API_KEY) {
    const graded = await callGeminiGrade(env.GEMINI_API_KEY, {
      studentName,
      sectionA: { ...sectionA, score: sectionAScore },
      sectionB,
      sectionC
    });
    if (graded.ok && graded.result) {
      aiUsed = true;
      modelName = graded.model;
      result = graded.result;
    }
  }

  if (!result) {
    result = buildFallbackResult({ sectionA: { ...sectionA, score: sectionAScore } });
  }

  const clamp = (n, max) => Math.max(0, Math.min(max, parseInt(n, 10) || 0));
  const q6Score = clamp(result.q6Score, 4);
  const q7Score = clamp(result.q7Score, 4);
  const q8Score = clamp(result.q8Score, 4);
  const q9Score = clamp(result.q9Score, 8);
  const sectionBScore = q6Score + q7Score + q8Score;
  const sectionCScore = q9Score;
  const totalScore = sectionAScore + sectionBScore + sectionCScore;

  const submissionId = `sub-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const misconceptions = Array.isArray(result.misconceptions) ? result.misconceptions : [];

  try {
    await env.DB.prepare(
      `INSERT INTO assessment_submissions
       (id, student_name, assess_date, section_a_score, section_b_score, section_c_score, total_score, answers_json, ai_result_json, misconceptions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        submissionId,
        studentName,
        assessDate,
        sectionAScore,
        sectionBScore,
        sectionCScore,
        totalScore,
        JSON.stringify({ sectionA, sectionB, sectionC }),
        JSON.stringify(result),
        JSON.stringify(misconceptions),
        createdAt
      )
      .run();
  } catch (err) {
    // Do not block student feedback if DB write fails
  }

  return jsonResponse({
    submissionId,
    studentName,
    assessDate,
    aiUsed,
    model: modelName,
    sectionAScore,
    sectionBScore,
    sectionCScore,
    totalScore,
    maxScore: 30,
    qScores: { q6: q6Score, q7: q7Score, q8: q8Score, q9: q9Score },
    questionFeedback: result.questionFeedback || {},
    misconceptions,
    followUpQuestions: Array.isArray(result.followUpQuestions) ? result.followUpQuestions : [],
    revisionNotes: Array.isArray(result.revisionNotes) ? result.revisionNotes : [],
    pendingAiReview: Boolean(result.pendingAiReview)
  }, 200);
}
