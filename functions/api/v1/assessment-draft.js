const TEACHER_PIN = '01823';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function countAnswered(answers) {
  let count = 0;
  const secA = answers?.sectionA || {};
  if (secA.q1) count++;
  if (Array.isArray(secA.q2) && secA.q2.every(Boolean)) count++;
  if (secA.q3) count++;
  if (Array.isArray(secA.q4) && secA.q4.every(Boolean)) count++;
  if (secA.q5) count++;

  const secB = answers?.sectionB || {};
  const q6 = secB.q6 || {};
  if (Object.values(q6).some((v) => typeof v === 'string' && v.trim())) count++;
  if (secB.q7a?.trim() || secB.q7b?.trim()) count++;
  const q8a = secB.q8a || {};
  if (Object.values(q8a).some((v) => typeof v === 'string' && v.trim()) || secB.q8b?.trim()) count++;
  if (answers?.sectionC?.q9?.trim()) count++;
  return count;
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
      `SELECT student_key, student_name, assess_date, section_a_score, answers_json, answered_count, updated_at
       FROM assessment_drafts
       ORDER BY updated_at DESC
       LIMIT 100`
    ).all();

    const drafts = (results || []).map((row) => {
      let answers = {};
      try { answers = JSON.parse(row.answers_json); } catch (_) {}
      return {
        studentKey: row.student_key,
        studentName: row.student_name,
        assessDate: row.assess_date,
        sectionAScore: row.section_a_score,
        answeredCount: row.answered_count,
        answers,
        updatedAt: row.updated_at
      };
    });

    return jsonResponse({ drafts }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Failed to load drafts' }, 500);
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

  const studentKey = studentName.toLowerCase().replace(/\s+/g, ' ');
  const assessDate = typeof body?.assessDate === 'string' ? body.assessDate.trim().slice(0, 20) : '';
  const sectionAScore = Math.max(0, Math.min(10, parseInt(body?.sectionA?.score, 10) || 0));
  const answers = {
    sectionA: body?.sectionA || {},
    sectionB: body?.sectionB || {},
    sectionC: body?.sectionC || {}
  };
  const answeredCount = countAnswered(answers);
  const updatedAt = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO assessment_drafts
       (student_key, student_name, assess_date, section_a_score, answers_json, answered_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_key) DO UPDATE SET
         student_name = excluded.student_name,
         assess_date = excluded.assess_date,
         section_a_score = excluded.section_a_score,
         answers_json = excluded.answers_json,
         answered_count = excluded.answered_count,
         updated_at = excluded.updated_at`
    )
      .bind(
        studentKey,
        studentName,
        assessDate,
        sectionAScore,
        JSON.stringify(answers),
        answeredCount,
        updatedAt
      )
      .run();

    return jsonResponse({ ok: true, studentKey, answeredCount, updatedAt }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Failed to save draft' }, 500);
  }
}
