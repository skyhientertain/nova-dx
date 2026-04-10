exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { symptoms } = JSON.parse(event.body);

    if (!symptoms || symptoms.trim().length < 10) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Input too short' }) };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: `You help people who feel something is wrong with their health but don't have words for it yet. Your job is to reflect back what they shared, help them see patterns others in similar situations describe, and guide them toward their next step.

Rules:
- Never name a condition, diagnosis, or disease
- Never express certainty about what is wrong
- Never use clinical jargon
- Speak simply and warmly, like a trusted friend who listens carefully
- Keep each section to 2-4 sentences

Respond ONLY with raw JSON — no markdown, no code fences, no preamble. Use exactly this structure:
{"reflection":"...","patterns":"...","navigation":"...","close":"..."}`,
        messages: [{ role: 'user', content: symptoms }]
      })
    });

    const data = await response.json();
    const raw = data.content[0].text;

    let parsed;
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { reflection: raw, patterns: '', navigation: '', close: '' };
    }

    // Log to Airtable (non-blocking)
    try {
      await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Submissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            Input: symptoms,
            Response: raw
          }
        })
      });
    } catch (logErr) {
      console.error('Airtable logging failed:', logErr);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
