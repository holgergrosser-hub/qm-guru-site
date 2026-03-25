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

function getEnv(name: string): string | undefined {
  return (globalThis as any)?.Netlify?.env?.get?.(name) ?? (process as any)?.env?.[name];
}

function lastUserQuestion(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const c = m?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      // Anthropic supports structured content; keep it simple.
      const text = c.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
      return text;
    }
    return String(c ?? "");
  }
  return "";
}

async function logQaToWebhook(question: string, answer: string) {
  const url = getEnv("QA_LOG_WEBHOOK_URL");
  if (!url) return;
  const token = getEnv("QA_LOG_WEBHOOK_TOKEN");

  // Google Apps Script Web Apps typically don't expose Authorization headers.
  // For compatibility, we append the token as a query param if provided.
  let targetUrl = url;
  if (token && !/[?&]token=/.test(targetUrl)) {
    const sep = targetUrl.includes("?") ? "&" : "?";
    targetUrl = `${targetUrl}${sep}token=${encodeURIComponent(token)}`;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ question, answer }),
  });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  const apiKey = getEnv("ANTHROPIC_API_KEY");
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

  const logConsent = body?.logConsent === true;
  const question = logConsent ? lastUserQuestion(payload.messages) : "";

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
      const upstreamBody = upstream.body;
      if (!upstreamBody || !logConsent || !question) {
        return new Response(upstreamBody, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": contentType,
            "Cache-Control": "no-cache",
          },
        });
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

      const tee = new ReadableStream<Uint8Array>({
        async start(controller) {
          const reader = upstreamBody.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                controller.enqueue(value);
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const rawLine of lines) {
                  const line = rawLine.replace(/\r$/, "");
                  if (!line.startsWith("data: ")) continue;
                  const data = line.slice(6).trim();
                  if (!data || data === "[DONE]") continue;
                  try {
                    const parsed = JSON.parse(data);
                    if (parsed?.type === "content_block_delta" && typeof parsed?.delta?.text === "string") {
                      answer += parsed.delta.text;
                    }
                    if (parsed?.type === "message_stop") {
                      // end marker; we still continue to forward remaining bytes if any
                    }
                  } catch {
                    // ignore
                  }
                }
              }
            }

            // flush tail (best-effort)
            const tail = (buffer || "").trim();
            if (tail.startsWith("data: ")) {
              const data = tail.slice(6).trim();
              try {
                const parsed = JSON.parse(data);
                if (parsed?.type === "content_block_delta" && typeof parsed?.delta?.text === "string") {
                  answer += parsed.delta.text;
                }
              } catch {
                // ignore
              }
            }

            if (question && answer) {
              try {
                await logQaToWebhook(question, answer);
              } catch {
                // Logging should never break the chat
              }
            }
          } finally {
            controller.close();
          }
        },
      });

      return new Response(tee, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    }

    const data = await upstream.json();
    if (logConsent && question) {
      try {
        const answer = Array.isArray((data as any)?.content)
          ? (data as any).content
              .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
              .join("")
          : "";
        if (answer) await logQaToWebhook(question, answer);
      } catch {
        // ignore logging errors
      }
    }
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
