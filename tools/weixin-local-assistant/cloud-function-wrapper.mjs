// 微信云端助手 HTTP 入口。本文件不能单独运行：构建脚本
// （scripts/build-weixin-assistant-dist.mjs）会把它拼接到 assistant-core.mjs 之后，
// 生成可直接粘贴到 Supabase Edge Functions 的单文件云函数。
// 这里可以直接使用 core 里的 pollOnce、getObjectJson、putObject 等函数（同一模块作用域）。

const CLOUD_CRON_SECRET_PATH = "weixin-cloud/cron-secret.json";
const CLOUD_ASSISTANT_STATE_PATH = "weixin-cloud/state/cloud-assistant.json";
// 单次调用的时间预算：Edge Function 免费档墙钟上限 150s，留足回复一个 Bot 的余量。
const CLOUD_POLL_BUDGET_MS = 120_000;

const CLOUD_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function cloudJsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CLOUD_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildCloudEnv(body) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_env: 未读到 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，请确认函数部署在你自己的 Supabase 项目里。");
  }
  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_BUCKET: typeof body?.bucket === "string" && body.bucket.trim() ? body.bucket.trim() : DEFAULT_BUCKET,
    WEIXIN_AUTO_REPLY: "true",
  };
}

async function verifyCloudCronToken(env, body) {
  const provided = typeof body?.token === "string" ? body.token.trim() : "";
  if (!provided) return { ok: false, status: 401, error: "missing_token" };
  const secret = await getObjectJson(env, CLOUD_CRON_SECRET_PATH).catch(() => null);
  const expected = typeof secret?.token === "string" ? secret.token.trim() : "";
  if (!expected) {
    return { ok: false, status: 500, error: "missing_cron_secret: 云端还没有部署密钥，请回到小手机微信设置重新复制定时 SQL。" };
  }
  if (provided !== expected) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true };
}

async function writeCloudHeartbeat(env, state) {
  await putObject(env, CLOUD_ASSISTANT_STATE_PATH, JSON.stringify({
    format: "ai-phone-weixin-cloud-assistant-state",
    version: 1,
    ...state,
  }, null, 2), "application/json").catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CLOUD_CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return cloudJsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  const body = await req.json().catch(() => ({}));
  let env;
  try {
    env = buildCloudEnv(body);
  } catch (err) {
    return cloudJsonResponse(500, { ok: false, error: errorMessage(err) });
  }

  const auth = await verifyCloudCronToken(env, body);
  if (!auth.ok) {
    return cloudJsonResponse(auth.status, { ok: false, error: auth.error });
  }

  // 媒体路径（生图/TTS/CDN 上传加密）尚未在 Deno 环境实测，默认降级为文字；
  // 定时 SQL 里传 {"media": true} 可显式开启。
  setMediaReplyEnabled(body?.media === true);

  const startedAt = Date.now();
  const targetBotId = typeof body?.bot === "string" && body.bot.trim() ? body.bot.trim() : undefined;
  try {
    const result = await pollOnce(env, targetBotId, { deadlineAt: startedAt + CLOUD_POLL_BUDGET_MS });
    const rows = Array.isArray(result?.results) ? result.results : [];
    const summary = {
      polled: rows.length,
      received: rows.reduce((sum, row) => sum + Number(row.received || 0), 0),
      stored: rows.reduce((sum, row) => sum + Number(row.stored || 0), 0),
      sent: rows.reduce((sum, row) => sum + Number(row.autoReply?.sent || 0), 0),
      skippedForDeadline: Number(result?.skippedForDeadline || 0),
      elapsedMs: Date.now() - startedAt,
      error: rows.map(row => row.autoReply?.error || (row.tokenExpired ? "Token 已过期，请重新扫码" : "")).find(Boolean),
    };
    await writeCloudHeartbeat(env, {
      lastRunAt: new Date().toISOString(),
      lastError: summary.error,
      ...summary,
    });
    return cloudJsonResponse(200, { ok: true, ...summary });
  } catch (err) {
    const message = errorMessage(err);
    await writeCloudHeartbeat(env, {
      lastRunAt: new Date().toISOString(),
      lastError: message,
      elapsedMs: Date.now() - startedAt,
    });
    return cloudJsonResponse(500, { ok: false, error: message });
  }
});
