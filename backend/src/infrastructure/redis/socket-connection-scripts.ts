export const SOCKET_CONNECTION_REDIS_KEY_PREFIX =
  "nexuschat:realtime:v1:{connection-state}";

export const SOCKET_CONNECTION_REDIS_KEYS = Object.freeze({
  sequence: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:sequence`,
  connections: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:connections`,
  leases: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:leases`,
  owners: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:owners`,
  onlineUsers: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:online-users`,
  presenceCurrent: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:presence-current`,
  presencePending: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:presence-pending`,
  presenceClaims: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:presence-claims`,
  presenceCleanup: `${SOCKET_CONNECTION_REDIS_KEY_PREFIX}:presence-cleanup`,
});

const redisTimeMilliseconds = `
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
`;

const enqueuePresenceTransition = `
local function enqueue_presence_transition(user_id, state, source_socket_id, version)
  local transition = {
    userId = user_id,
    state = state,
    version = version,
    sourceSocketId = source_socket_id
  }
  redis.call('HSET', KEYS[6], user_id, cjson.encode(transition))
  redis.call('ZADD', KEYS[7], version, user_id)
  redis.call('ZREM', KEYS[8], user_id)
  return transition
end
`;

const decodeConnections = `
local function decode_connections(raw_connections)
  if not raw_connections then
    return {}
  end
  return cjson.decode(raw_connections)
end
`;

export const ADD_SOCKET_CONNECTION_SCRIPT = `${redisTimeMilliseconds}
${decodeConnections}
${enqueuePresenceTransition}

local user_id = ARGV[1]
local socket_id = ARGV[2]
local connection_key = ARGV[3]
local maximum_connections = tonumber(ARGV[4])
local lease_ttl = tonumber(ARGV[5])
local expires_at = now + lease_ttl
local connections = decode_connections(redis.call('HGET', KEYS[2], user_id))
local active = {}

for index = 1, #connections do
  local connection = connections[index]
  if tonumber(connection.expiresAt) > now then
    table.insert(active, connection)
  else
    redis.call('ZREM', KEYS[3], connection.key)
    redis.call('HDEL', KEYS[4], connection.key)
  end
end

for index = 1, #active do
  local connection = active[index]
  if connection.key == connection_key then
    connection.expiresAt = expires_at
    redis.call('HSET', KEYS[2], user_id, cjson.encode(active))
    redis.call('ZADD', KEYS[3], expires_at, connection_key)
    redis.call('HSET', KEYS[4], connection_key, cjson.encode({
      userId = user_id,
      socketId = socket_id
    }))
    return cjson.encode({ accepted = true, firstConnection = false })
  end
end

if #active >= maximum_connections then
  redis.call('HSET', KEYS[2], user_id, cjson.encode(active))
  return cjson.encode({ accepted = false, firstConnection = false })
end

local first_connection = #active == 0
local registration_sequence = redis.call('INCR', KEYS[1])
table.insert(active, {
  key = connection_key,
  socketId = socket_id,
  sequence = registration_sequence,
  expiresAt = expires_at
})

redis.call('HSET', KEYS[2], user_id, cjson.encode(active))
redis.call('ZADD', KEYS[3], expires_at, connection_key)
redis.call('HSET', KEYS[4], connection_key, cjson.encode({
  userId = user_id,
  socketId = socket_id
}))

local result = { accepted = true, firstConnection = first_connection }
if first_connection then
  redis.call('ZADD', KEYS[5], registration_sequence, user_id)
  result.presenceTransition = enqueue_presence_transition(
    user_id,
    'online',
    socket_id,
    registration_sequence
  )
end

return cjson.encode(result)
`;

export const REMOVE_SOCKET_CONNECTION_SCRIPT = `${redisTimeMilliseconds}
${decodeConnections}
${enqueuePresenceTransition}

local user_id = ARGV[1]
local socket_id = ARGV[2]
local connection_key = ARGV[3]
local connections = decode_connections(redis.call('HGET', KEYS[2], user_id))
local active = {}
local removed = false

for index = 1, #connections do
  local connection = connections[index]
  if tonumber(connection.expiresAt) <= now then
    redis.call('ZREM', KEYS[3], connection.key)
    redis.call('HDEL', KEYS[4], connection.key)
  elseif connection.key == connection_key then
    removed = true
    redis.call('ZREM', KEYS[3], connection.key)
    redis.call('HDEL', KEYS[4], connection.key)
  else
    table.insert(active, connection)
  end
end

local result = {
  removed = removed,
  lastConnection = removed and #active == 0
}

if #active > 0 then
  redis.call('HSET', KEYS[2], user_id, cjson.encode(active))
else
  redis.call('HDEL', KEYS[2], user_id)
  if #connections > 0 and redis.call('ZREM', KEYS[5], user_id) == 1 then
    local version = redis.call('INCR', KEYS[1])
    result.presenceTransition = enqueue_presence_transition(
      user_id,
      'offline',
      socket_id,
      version
    )
  end
end

return cjson.encode(result)
`;

export const READ_USER_CONNECTIONS_SCRIPT = `${redisTimeMilliseconds}
${decodeConnections}
${enqueuePresenceTransition}

local user_id = ARGV[1]
local source_socket_id = ARGV[2]
local connections = decode_connections(redis.call('HGET', KEYS[2], user_id))
local active = {}
local socket_ids = {}

for index = 1, #connections do
  local connection = connections[index]
  if tonumber(connection.expiresAt) > now then
    table.insert(active, connection)
    table.insert(socket_ids, connection.socketId)
  else
    redis.call('ZREM', KEYS[3], connection.key)
    redis.call('HDEL', KEYS[4], connection.key)
  end
end

local result = { sockets = socket_ids }
if #active > 0 then
  redis.call('HSET', KEYS[2], user_id, cjson.encode(active))
else
  redis.call('HDEL', KEYS[2], user_id)
  if #connections > 0 and redis.call('ZREM', KEYS[5], user_id) == 1 then
    local version = redis.call('INCR', KEYS[1])
    result.presenceTransition = enqueue_presence_transition(
      user_id,
      'offline',
      source_socket_id,
      version
    )
  end
end

return cjson.encode(result)
`;

export const RENEW_SOCKET_LEASES_SCRIPT = `${redisTimeMilliseconds}

local lease_ttl = tonumber(ARGV[1])
local connection_keys = cjson.decode(ARGV[2])
local expires_at = now + lease_ttl
local renewed = {}
local missing = {}

for key_index = 1, #connection_keys do
  local connection_key = connection_keys[key_index]
  local owner_raw = redis.call('HGET', KEYS[3], connection_key)
  local renewed_connection = false

  if owner_raw then
    local owner = cjson.decode(owner_raw)
    local connections_raw = redis.call('HGET', KEYS[1], owner.userId)
    if connections_raw then
      local connections = cjson.decode(connections_raw)
      for connection_index = 1, #connections do
        local connection = connections[connection_index]
        if connection.key == connection_key and tonumber(connection.expiresAt) > now then
          connection.expiresAt = expires_at
          redis.call('HSET', KEYS[1], owner.userId, cjson.encode(connections))
          redis.call('ZADD', KEYS[2], expires_at, connection_key)
          table.insert(renewed, connection_key)
          renewed_connection = true
          break
        end
      end
    end
  end

  if not renewed_connection then
    table.insert(missing, connection_key)
  end
end

return cjson.encode({ renewed = renewed, missing = missing })
`;

export const REAP_EXPIRED_SOCKET_LEASES_SCRIPT = `${redisTimeMilliseconds}
${decodeConnections}
${enqueuePresenceTransition}

local limit = tonumber(ARGV[1])
local expired_keys = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, limit)
local transitions = {}
local processed = 0
local consistent = true

for expired_index = 1, #expired_keys do
  local connection_key = expired_keys[expired_index]
  local owner_raw = redis.call('HGET', KEYS[4], connection_key)

  if owner_raw then
    local owner = cjson.decode(owner_raw)
    local connections = decode_connections(redis.call('HGET', KEYS[2], owner.userId))
    local matching_connection = nil
    local match_count = 0

    for connection_index = 1, #connections do
      local connection = connections[connection_index]
      if connection.key == connection_key then
        matching_connection = connection
        match_count = match_count + 1
      end
    end

    if match_count ~= 1
      or matching_connection.socketId ~= owner.socketId
      or tonumber(matching_connection.expiresAt) > now then
      consistent = false
    else
      local active = {}
      for connection_index = 1, #connections do
        local connection = connections[connection_index]
        if connection.key ~= connection_key then
          table.insert(active, connection)
        end
      end

      redis.call('ZREM', KEYS[3], connection_key)
      redis.call('HDEL', KEYS[4], connection_key)
      processed = processed + 1

      if #active > 0 then
        redis.call('HSET', KEYS[2], owner.userId, cjson.encode(active))
      else
        redis.call('HDEL', KEYS[2], owner.userId)
        if redis.call('ZREM', KEYS[5], owner.userId) == 1 then
          local version = redis.call('INCR', KEYS[1])
          local transition = enqueue_presence_transition(
            owner.userId,
            'offline',
            owner.socketId,
            version
          )
          table.insert(transitions, transition)
        end
      end
    end
  else
    consistent = false
  end
end

local more = redis.call('ZCOUNT', KEYS[3], '-inf', now) > 0
return cjson.encode({
  processed = processed,
  more = more,
  consistent = consistent,
  transitions = transitions
})
`;

export const LIST_ONLINE_USERS_SCRIPT = `${redisTimeMilliseconds}

if redis.call('ZCOUNT', KEYS[1], '-inf', now) > 0 then
  return cjson.encode({ complete = false })
end

return cjson.encode({
  complete = true,
  onlineUserIds = redis.call('ZRANGE', KEYS[2], 0, -1)
})
`;

export const LIST_PENDING_PRESENCE_SCRIPT = `
local limit = tonumber(ARGV[1])
local user_ids = redis.call('ZRANGE', KEYS[2], 0, limit - 1)
local transitions = {}

for index = 1, #user_ids do
  local user_id = user_ids[index]
  local desired = redis.call('HGET', KEYS[1], user_id)
  if desired then
    table.insert(transitions, cjson.decode(desired))
  else
    redis.call('ZREM', KEYS[2], user_id)
  end
end

return cjson.encode({ transitions = transitions })
`;

export const CLAIM_PRESENCE_SCRIPT = `${redisTimeMilliseconds}

local user_id = ARGV[1]
local token = ARGV[2]
local claim_ttl = tonumber(ARGV[3])
local desired = redis.call('HGET', KEYS[1], user_id)
if not desired or not redis.call('ZSCORE', KEYS[2], user_id) then
  return false
end

local existing_raw = redis.call('HGET', KEYS[3], user_id)
if existing_raw then
  local existing = cjson.decode(existing_raw)
  if tonumber(existing.expiresAt) > now and existing.token ~= token then
    return false
  end
end

redis.call('HSET', KEYS[3], user_id, cjson.encode({
  token = token,
  expiresAt = now + claim_ttl
}))
return desired
`;

export const GET_CLAIMED_PRESENCE_SCRIPT = `${redisTimeMilliseconds}

local user_id = ARGV[1]
local token = ARGV[2]
local claim_raw = redis.call('HGET', KEYS[2], user_id)
if not claim_raw then
  return false
end

local claim = cjson.decode(claim_raw)
if claim.token ~= token or tonumber(claim.expiresAt) <= now then
  return false
end

return redis.call('HGET', KEYS[1], user_id)
`;

export const COMPLETE_PRESENCE_SCRIPT = `${redisTimeMilliseconds}

local user_id = ARGV[1]
local token = ARGV[2]
local version = tonumber(ARGV[3])
local truth_retention = tonumber(ARGV[4])
local claim_raw = redis.call('HGET', KEYS[3], user_id)
if not claim_raw then
  return 0
end

local claim = cjson.decode(claim_raw)
if claim.token ~= token or tonumber(claim.expiresAt) <= now then
  return 0
end

local current_raw = redis.call('HGET', KEYS[1], user_id)
if not current_raw then
  redis.call('HDEL', KEYS[3], user_id)
  redis.call('ZREM', KEYS[2], user_id)
  return 0
end

local current = cjson.decode(current_raw)
if tonumber(current.version) ~= version then
  redis.call('HDEL', KEYS[3], user_id)
  return 0
end

redis.call('ZREM', KEYS[2], user_id)
redis.call('HDEL', KEYS[3], user_id)
current.reconciledAt = now
redis.call('HSET', KEYS[1], user_id, cjson.encode(current))
if current.state == 'offline' then
  redis.call('ZADD', KEYS[4], now + truth_retention, user_id)
else
  redis.call('ZREM', KEYS[4], user_id)
end
return 1
`;

export const RELEASE_PRESENCE_CLAIM_SCRIPT = `
local user_id = ARGV[1]
local token = ARGV[2]
local claim_raw = redis.call('HGET', KEYS[1], user_id)
if not claim_raw then
  return 0
end

local claim = cjson.decode(claim_raw)
if claim.token ~= token then
  return 0
end

return redis.call('HDEL', KEYS[1], user_id)
`;

export const CLEANUP_SETTLED_PRESENCE_SCRIPT = `${redisTimeMilliseconds}

local limit = tonumber(ARGV[1])
local retention = tonumber(ARGV[2])
local user_ids = redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now, 'LIMIT', 0, limit)
local cleaned = 0

for index = 1, #user_ids do
  local user_id = user_ids[index]
  local current_raw = redis.call('HGET', KEYS[1], user_id)
  local has_pending = redis.call('ZSCORE', KEYS[2], user_id)
  local has_claim = redis.call('HGET', KEYS[3], user_id)

  if not current_raw then
    redis.call('ZREM', KEYS[4], user_id)
  else
    local current = cjson.decode(current_raw)
    if current.state ~= 'offline' then
      redis.call('ZREM', KEYS[4], user_id)
    elseif has_pending or has_claim then
      redis.call('ZADD', KEYS[4], now + retention, user_id)
    else
      redis.call('HDEL', KEYS[1], user_id)
      redis.call('ZREM', KEYS[4], user_id)
      cleaned = cleaned + 1
    end
  end
end

local more = redis.call('ZCOUNT', KEYS[4], '-inf', now) > 0
return cjson.encode({ processed = #user_ids, cleaned = cleaned, more = more })
`;
