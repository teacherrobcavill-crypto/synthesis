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
  const { request, env } = context;
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  const name = (url.searchParams.get('name') || '').trim();

  if (!id && !name) {
    return jsonResponse({ error: 'Please enter your name to load your feedback.' }, 400);
  }

  try {
    let row = null;
    if (id) {
      row = await env.DB.prepare(
        `SELECT id, student_name, assess_date, section_a_score, section_b_score, section_c_score, total_score, answers_json, ai_result_json, misconceptions_json, created_at
         FROM assessment_submissions
         WHERE id = ?
         LIMIT 1`
      )
        .bind(id)
        .first();
    } else {
      row = await env.DB.prepare(
        `SELECT id, student_name, assess_date, section_a_score, section_b_score, section_c_score, total_score, answers_json, ai_result_json, misconceptions_json, created_at
         FROM assessment_submissions
         WHERE LOWER(TRIM(student_name)) = LOWER(?)
         ORDER BY created_at DESC
         LIMIT 1`
      )
        .bind(name)
        .first();
    }

    if (!row) {
      return jsonResponse({ error: 'No submission found for that name yet. Check spelling or submit the assessment first.' }, 404);
    }

    let answers = {};
    let aiResult = {};
    let misconceptions = [];
    try { answers = JSON.parse(row.answers_json); } catch (_) {}
    try { aiResult = JSON.parse(row.ai_result_json); } catch (_) {}
    try { misconceptions = JSON.parse(row.misconceptions_json); } catch (_) {}

    return jsonResponse({
      id: row.id,
      studentName: row.student_name,
      assessDate: row.assess_date || (row.created_at || '').slice(0, 10),
      sectionAScore: row.section_a_score,
      sectionBScore: row.section_b_score,
      sectionCScore: row.section_c_score,
      totalScore: row.total_score,
      maxScore: 30,
      qScores: {
        q6: aiResult.q6Score ?? 0,
        q7: aiResult.q7Score ?? 0,
        q8: aiResult.q8Score ?? 0,
        q9: aiResult.q9Score ?? 0
      },
      answers,
      questionFeedback: aiResult.questionFeedback || {},
      misconceptions,
      followUpQuestions: Array.isArray(aiResult.followUpQuestions) ? aiResult.followUpQuestions : [],
      revisionNotes: Array.isArray(aiResult.revisionNotes) ? aiResult.revisionNotes : []
    }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Failed to load student feedback.' }, 500);
  }
}
