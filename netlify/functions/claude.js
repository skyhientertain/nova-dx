exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);

    // Support both single symptom string and multi-turn messages array
    const messages = body.messages || [{ role: 'user', content: body.symptoms }];
    const symptoms = messages[0]?.content || '';

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
- Keep each section focused and human
- If this is a follow-up message, continue the conversation naturally — acknowledge what they've added, adjust your reflection, and build on what you've learned about them

Respond ONLY with raw JSON — no markdown, no code fences, no preamble. Always use this exact structure:
{"reflection":"...","patterns":"...","navigation":"...","close":"..."}

For follow-up messages, you may leave "patterns" or "navigation" empty if not relevant, but always provide "reflection" and "close".`,
        messages: messages
      })
    });

    const data = await response.json();
    const raw = data.content[0].text;

    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { reflection: raw, patterns: '', navigation: '', close: '' };
    }

    // Log to Airtable — latest user message and response
    try {
      const latestUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || symptoms;
      await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Submissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: { Input: latestUserMsg, Response: raw } })
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
