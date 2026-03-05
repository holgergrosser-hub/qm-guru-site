// =============================================
// QM-Guru Claude Proxy — Netlify Function (modern)
// API Key bleibt serverseitig in Netlify Env Vars
// Unterstützt Streaming (SSE) für Chat & Gap-Report
// =============================================

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  const apiKey =
    (globalThis as any)?.Netlify?.env?.get?.("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "API Key not configured. Bitte in Netlify Environment Variables setzen.",
      }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }

  const payload = {
    model: "claude-sonnet-4-20250514",
    max_tokens: Math.min(body?.max_tokens || 1500, 8000),
    stream: body?.stream === true,
    system: body?.system || "",
    messages: body?.messages || [],
  };

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: "Upstream Anthropic error",
          status: upstream.status,
          details: text ? text.slice(0, 2000) : "",
        }),
        {
          status: upstream.status,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (payload.stream) {
      const contentType = upstream.headers.get("content-type") || "text/event-stream; charset=utf-8";
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    }

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Proxy error: " + (err?.message || String(err)) }), {
      status: 502,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }
};
