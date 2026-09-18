const LOCAL = {
    gemini: { dayStartedAt: Date.now(), dailyUsed: 0, minuteStartedAt: Date.now(), minuteUsed: 0, lastRequestAt: 0 },
    openrouter: { dayStartedAt: Date.now(), dailyUsed: 0, minuteStartedAt: Date.now(), minuteUsed: 0, lastRequestAt: 0 },
    groq: { dayStartedAt: Date.now(), dailyUsed: 0, minuteStartedAt: Date.now(), minuteUsed: 0, lastRequestAt: 0 },
};
const locks = { gemini: Promise.resolve(), openrouter: Promise.resolve(), groq: Promise.resolve() };
function intEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
export function freeAIProviderLimits(provider) {
    if (provider === 'gemini')
        return {
            // Conservative local cap below the commonly reported 20 RPD for Gemini 3.8 Flash.
            // The actual account/model quota remains authoritative and can be lowered via env.
            daily: intEnv('GEMINI_FREE_DAILY_LIMIT', 10),
            perMinute: intEnv('GEMINI_FREE_RPM_LIMIT', 4),
            minIntervalMs: intEnv('GEMINI_FREE_MIN_INTERVAL_MS', 15000),
        };
    if (provider === 'openrouter')
        return {
            // OpenRouter Free currently documents 50 req/day; use 45 as an application-level reserve.
            daily: intEnv('OPENROUTER_FREE_DAILY_LIMIT', 45),
            perMinute: intEnv('OPENROUTER_FREE_RPM_LIMIT', 18),
            minIntervalMs: intEnv('OPENROUTER_FREE_MIN_INTERVAL_MS', 3500),
        };
    return {
        // Groq limits vary by account/model. Keep a deliberately conservative default until the account limits are confirmed.
        daily: intEnv('GROQ_FREE_DAILY_LIMIT', 20),
        perMinute: intEnv('GROQ_FREE_RPM_LIMIT', 4),
        minIntervalMs: intEnv('GROQ_FREE_MIN_INTERVAL_MS', 15000),
    };
}
function nowState(provider) {
    const now = Date.now();
    const state = LOCAL[provider];
    if (now - state.dayStartedAt >= 24 * 60 * 60 * 1000) {
        state.dayStartedAt = now;
        state.dailyUsed = 0;
    }
    if (now - state.minuteStartedAt >= 60 * 1000) {
        state.minuteStartedAt = now;
        state.minuteUsed = 0;
    }
    return { now, state, limits: freeAIProviderLimits(provider) };
}
async function delay(ms) { if (ms > 0)
    await new Promise(resolve => setTimeout(resolve, ms)); }
async function reserveLocal(provider) {
    const { now, state, limits } = nowState(provider);
    if (limits.daily <= 0 || limits.perMinute <= 0)
        throw Object.assign(new Error(`${provider} free-tier inference is disabled by ClinAI configuration.`), { code: 'AI_FREE_QUOTA_DISABLED', statusCode: 503, provider });
    if (state.dailyUsed >= limits.daily)
        throw Object.assign(new Error(`${provider} free-tier safety budget is exhausted.`), { code: 'AI_FREE_QUOTA_EXHAUSTED', statusCode: 429, provider });
    if (state.minuteUsed >= limits.perMinute)
        throw Object.assign(new Error(`${provider} free-tier per-minute safety budget is exhausted.`), { code: 'AI_FREE_RATE_LIMITED', statusCode: 429, provider });
    const waitFor = Math.max(0, limits.minIntervalMs - (now - state.lastRequestAt));
    if (waitFor > 0)
        await delay(waitFor);
    const afterWait = Date.now();
    state.lastRequestAt = afterWait;
    state.minuteUsed += 1;
    state.dailyUsed += 1;
}
async function reserveDatabase(pool, provider) {
    const limits = freeAIProviderLimits(provider);
    const client = await pool.connect();
    let released = false;
    try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO ai_free_quota_state(provider_key,daily_limit,daily_used,day_started_at,minute_limit,minute_used,minute_started_at,last_request_at) VALUES($1,$2,0,now(),$3,0,now(),NULL) ON CONFLICT(provider_key) DO UPDATE SET daily_limit=EXCLUDED.daily_limit,minute_limit=EXCLUDED.minute_limit,updated_at=now()`, [provider, limits.daily, limits.perMinute]);
        const row = (await client.query(`SELECT provider_key,daily_limit,daily_used,day_started_at,minute_limit,minute_used,minute_started_at,last_request_at FROM ai_free_quota_state WHERE provider_key=$1 FOR UPDATE`, [provider])).rows[0];
        const now = Date.now();
        const dayStart = new Date(row.day_started_at).getTime();
        const minuteStart = new Date(row.minute_started_at).getTime();
        let dailyUsed = Number(row.daily_used || 0);
        let minuteUsed = Number(row.minute_used || 0);
        let effectiveDayStart = row.day_started_at;
        let effectiveMinuteStart = row.minute_started_at;
        if (now - dayStart >= 24 * 60 * 60 * 1000) {
            dailyUsed = 0;
            effectiveDayStart = new Date().toISOString();
        }
        if (now - minuteStart >= 60 * 1000) {
            minuteUsed = 0;
            effectiveMinuteStart = new Date().toISOString();
        }
        if (limits.daily <= 0 || limits.perMinute <= 0)
            throw Object.assign(new Error(`${provider} free-tier inference is disabled by ClinAI configuration.`), { code: 'AI_FREE_QUOTA_DISABLED', statusCode: 503, provider });
        if (dailyUsed >= limits.daily)
            throw Object.assign(new Error(`${provider} free-tier safety budget is exhausted.`), { code: 'AI_FREE_QUOTA_EXHAUSTED', statusCode: 429, provider });
        if (minuteUsed >= limits.perMinute)
            throw Object.assign(new Error(`${provider} free-tier per-minute safety budget is exhausted.`), { code: 'AI_FREE_RATE_LIMITED', statusCode: 429, provider });
        const lastAt = row.last_request_at ? new Date(row.last_request_at).getTime() : 0;
        const waitFor = Math.max(0, limits.minIntervalMs - (now - lastAt));
        if (waitFor > 0) {
            await client.query('ROLLBACK');
            client.release();
            released = true;
            await delay(waitFor);
            return reserveDatabase(pool, provider);
        }
        await client.query(`UPDATE ai_free_quota_state SET daily_used=$2, day_started_at=$3, minute_used=$4, minute_started_at=$5, last_request_at=now(), updated_at=now() WHERE provider_key=$1`, [provider, dailyUsed + 1, effectiveDayStart, minuteUsed + 1, effectiveMinuteStart]);
        await client.query('COMMIT');
    }
    catch (error) {
        try {
            await client.query('ROLLBACK');
        }
        catch { }
        throw error;
    }
    finally {
        if (!released)
            client.release();
    }
}
export async function reserveFreeAIRequest(pool, provider) {
    let release;
    const prior = locks[provider];
    locks[provider] = new Promise(resolve => { release = resolve; });
    await prior.catch(() => undefined);
    try {
        // The database is the authoritative cross-instance limiter when available.
        if (pool)
            await reserveDatabase(pool, provider);
        else
            await reserveLocal(provider);
    }
    finally {
        release();
    }
}
export async function freeAIQuotaStatus(pool) {
    const providers = {};
    for (const provider of ['gemini', 'openrouter', 'groq']) {
        const limits = freeAIProviderLimits(provider);
        const local = nowState(provider);
        providers[provider] = { dailyLimit: limits.daily, perMinuteLimit: limits.perMinute, minIntervalMs: limits.minIntervalMs, localDailyUsed: local.state.dailyUsed, localMinuteUsed: local.state.minuteUsed };
    }
    if (pool) {
        try {
            const rows = (await pool.query(`SELECT provider_key,daily_limit,daily_used,day_started_at,minute_limit,minute_used,minute_started_at,last_request_at,updated_at FROM ai_free_quota_state ORDER BY provider_key`)).rows;
            for (const row of rows)
                providers[row.provider_key] = { ...providers[row.provider_key], dailyLimit: Number(row.daily_limit), dailyUsed: Number(row.daily_used), dayStartedAt: row.day_started_at, perMinuteLimit: Number(row.minute_limit), minuteUsed: Number(row.minute_used), minuteStartedAt: row.minute_started_at, lastRequestAt: row.last_request_at, updatedAt: row.updated_at };
        }
        catch { }
    }
    return { freeOnlyRuntime: process.env.CLINAI_FREE_ONLY_RUNTIME !== 'false', providers };
}
