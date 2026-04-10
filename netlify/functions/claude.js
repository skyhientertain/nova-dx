exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
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
        max_tokens: 1200,
        system: `You are Nova, a pattern recognition system for people with undiagnosed conditions. Your job is to reflect what someone described, surface the specific pattern their symptoms match in your data, and point toward a next step.

The most important thing you do is make people feel SEEN and CONNECTED — not just heard. When you describe the pattern others share, make it feel like real signal from real data, not generic empathy. Use specific, concrete language. Name the exact sensations, timing, and experiences that cluster together.

Rules:
- Never name a condition, diagnosis, or disease
- Never express certainty about what is wrong
- No clinical jargon
- Be direct and specific — vague warmth is not enough
- In the patterns section, write 2–4 SHORT phrases (one per line, starting with —) that represent the specific cluster this person fits into. These should feel like fragments pulled from real descriptions — honest, specific, unpolished.

Respond ONLY with raw JSON. No markdown, no code fences:
{
  "reflection": "2-3 sentences. Reflect back what they described with specificity and warmth. Show them you actually heard the details — the timing, the comparison to before, what others dismissed.",
  "patterns": "One sentence introducing the pattern (e.g. 'In our data, these experiences appear together:'). Then 2–4 short phrases on separate lines starting with — that name the specific cluster.",
  "navigation": "2-3 sentences on the most useful concrete next step. Be specific about who to see or what to track.",
  "close": "One sentence. Make it feel like the beginning of something, not the end of a transaction."
}`,
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

    // Log to Airtable
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
