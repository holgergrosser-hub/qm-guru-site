// =============================================
// QM-Guru Claude Proxy — Netlify Function
// API Key bleibt serverseitig in Netlify Env Vars
// Unterstützt Streaming (SSE) für Chat & Gap-Report
// =============================================

exports.handler = async function(event, context) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'API Key not configured. Bitte in Netlify Environment Variables setzen.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Security: only allow our model, cap tokens
  const payload = {
    model: 'claude-sonnet-4-20250514',
    // Frontend may request larger outputs for full gap reports.
    // Keep a hard cap to control cost.
    max_tokens: Math.min(body.max_tokens || 1500, 8000),
    stream: body.stream === true,
    system: body.system || '',
    messages: body.messages || [],
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    // If Anthropic returns an error, pass it through with the real status code.
    // This prevents the frontend from showing an empty report with HTTP 200.
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Upstream Anthropic error',
          status: response.status,
          details: text ? text.slice(0, 2000) : '',
        }),
      };
    }

    // For streaming: pipe through as SSE
    if (payload.stream) {
      const text = await response.text();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        },
        body: text,
      };
    }

    // Non-streaming: return JSON
    const data = await response.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(data),
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Proxy error: ' + err.message }),
    };
  }
};
