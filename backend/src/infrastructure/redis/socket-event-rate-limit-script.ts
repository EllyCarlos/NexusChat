export const SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX =
  "nexuschat:realtime:v1:rate-limit:";

export const CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT = `
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local maximum_safe_integer = 9007199254740991

local function decision(allowed)
  return cjson.encode({ allowed = allowed })
end

local function invalid_policy()
  return redis.error_reply('INVALID_RATE_LIMIT_POLICY')
end

local function invalid_state()
  return redis.error_reply('INVALID_RATE_LIMIT_STATE')
end

if not limit
  or limit <= 0
  or limit > maximum_safe_integer
  or limit % 1 ~= 0
  or not window_ms
  or window_ms <= 0
  or window_ms > maximum_safe_integer
  or window_ms % 1 ~= 0 then
  return invalid_policy()
end

local state = redis.call('HMGET', KEYS[1], 'count', 'resetAt')
local raw_count = state[1]
local raw_reset_at = state[2]

if not raw_count and not raw_reset_at then
  if redis.call('EXISTS', KEYS[1]) ~= 0 then
    return invalid_state()
  end

  local reset_at = now + window_ms
  if reset_at > maximum_safe_integer or reset_at % 1 ~= 0 then
    return invalid_policy()
  end

  redis.call('HSET', KEYS[1], 'count', 1, 'resetAt', reset_at)
  if redis.call('PEXPIREAT', KEYS[1], reset_at) ~= 1 then
    redis.call('DEL', KEYS[1])
    return invalid_state()
  end
  return decision(true)
end

if not raw_count or not raw_reset_at then
  return invalid_state()
end

local count = tonumber(raw_count)
local reset_at = tonumber(raw_reset_at)
local ttl = redis.call('PTTL', KEYS[1])

if not count
  or count < 1
  or count > maximum_safe_integer
  or count % 1 ~= 0
  or not reset_at
  or reset_at <= now
  or reset_at > maximum_safe_integer
  or reset_at % 1 ~= 0
  or ttl <= 0
  or ttl > window_ms
  or math.abs(ttl - (reset_at - now)) > 1000 then
  return invalid_state()
end

if redis.call('HLEN', KEYS[1]) ~= 2 then
  return invalid_state()
end

if count >= limit then
  return decision(false)
end

redis.call('HINCRBY', KEYS[1], 'count', 1)
return decision(true)
`;
