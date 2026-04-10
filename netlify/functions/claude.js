exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages || [{ role: 'user', content: body.symptoms }];
    const mode = body.mode || 'write';
    const symptoms = messages[0]?.content || '';
    if (!symptoms || symptoms.trim().length < 3) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Input too short' }) };
    }

    const writePrompt = `You are Nova, a pattern recognition system for people with undiagnosed conditions. Reflect what someone described, surface the specific pattern their symptoms match, and point toward a next step.

Make people feel SEEN and CONNECTED. When you describe the pattern others share, make it feel like real signal from real data — specific, concrete, not generic empathy.

Rules:
- Never name a condition, diagnosis, or disease
- Never express certainty about what is wrong
- No clinical jargon
- Be direct and specific
- In the patterns field: one short intro sentence, then 2–4 short phrases on separate lines starting with — that represent the specific cluster

Respond ONLY with raw JSON, no markdown, no code fences:
{"reflection":"2-3 sentences, specific and warm. Show you heard the details.","patterns":"One intro sentence.\n— specific phrase\n— specific phrase\n— specific phrase","navigation":"2-3 sentences, concrete next step.","close":"One sentence. The beginning of something."}`;

    const guidedPrompt = `You are Nova, having a gentle conversation to understand someone's undiagnosed health situation. Ask ONE thoughtful question at a time. Follow the thread naturally. After 3-5 exchanges when you understand their pattern, stop asking and deliver the full analysis.

Cover naturally across the conversation: what they're experiencing, how long, what makes it worse, what doctors have said, how it's changed their life. Don't cover these systematically — follow what they give you.

Rules:
- Never name a condition, diagnosis, or disease  
- One question at a time, conversational
- When delivering analysis, patterns should have 2–4 specific phrases starting with —

While gathering: respond ONLY with {"question":"Your single question here","done":false}
When ready to analyze (after 3-5 exchanges): respond ONLY with {"reflection":"...","patterns":"Intro sentence.\n— phrase\n— phrase\n— phrase","navigation":"...","close":"...","done":true}

No markdown, no code fences.`;

    const systemPrompt = mode === 'guided' ? guidedPrompt : writePrompt;

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
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await response.json();
    const raw = data.content[0].text;

    let parsed;
    try {
      let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      // If response has preamble before JSON, find the first { or [
      if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
        const idx = cleaned.indexOf('{');
        if (idx >= 0) cleaned = cleaned.slice(idx);
      }
      // Strip any trailing content after the closing }
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace >= 0) cleaned = cleaned.slice(0, lastBrace + 1);
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = mode === 'guided'
        ? { question: raw, done: false }
        : { reflection: raw, patterns: '', navigation: '', close: '' };
    }

    // Log to Airtable (only on analysis delivery, not mid-conversation questions)
    const shouldLog = mode === 'write' || (mode === 'guided' && parsed.done === true);
    if (shouldLog) {
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
