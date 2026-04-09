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

Respond in this exact JSON format:
{
  "reflection": "A warm, human summary of what they described in your own words",
  "patterns": "What others in similar situations often describe - normalize their experience without naming conditions",
  "navigation": "Practical next steps they can take - who to see, what to track, how to prepare for a doctor visit",
  "close": "A brief closing that acknowledges their courage in seeking help and affirms they deserve answers"
}`,
        messages: [{ role: 'user', content: symptoms }]
      })
    });

    const data = await response.json();
    const raw = data.content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { reflection: raw, patterns: '', navigation: '', close: '' };
    }

    // Log to Airtable
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
            Response: raw,
            Timestamp: new Date().toISOString()
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
