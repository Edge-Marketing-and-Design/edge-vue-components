// Existing post/event normalization, time conversion and validation shared by both editors and Functions.
const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value)
export const POST_EVENT_STATUSES = Object.freeze(['scheduled', 'cancelled', 'completed'])

const EVENT_STRING_FIELDS = ['startAt', 'endAt', 'timezone', 'locationName', 'locationAddress', 'meetingUrl', 'registrationUrl', 'status']
const EVENT_BOOLEAN_FIELDS = ['unpublishPastEvent', 'isVirtual']
// Fields an operation may give; startAtUtc, endAtUtc and isPast are computed.
export const POST_EVENT_FIELDS = Object.freeze([...EVENT_STRING_FIELDS, ...EVENT_BOOLEAN_FIELDS, 'capacity'])

export const normalizePostEvent = (event = {}, defaultTimezone = 'UTC') => {
  const source = isPlainObject(event) ? event : {}
  const text = key => (typeof source[key] === 'string' ? source[key] : '')
  return {
    ...source,
    startAt: text('startAt'),
    endAt: text('endAt'),
    startAtUtc: text('startAtUtc'),
    endAtUtc: text('endAtUtc'),
    isPast: typeof source.isPast === 'boolean' ? source.isPast : false,
    unpublishPastEvent: typeof source.unpublishPastEvent === 'boolean' ? source.unpublishPastEvent : true,
    timezone: text('timezone') || defaultTimezone,
    locationName: text('locationName'),
    locationAddress: text('locationAddress'),
    isVirtual: typeof source.isVirtual === 'boolean' ? source.isVirtual : false,
    meetingUrl: text('meetingUrl'),
    registrationUrl: text('registrationUrl'),
    capacity: typeof source.capacity === 'number' ? source.capacity : null,
    status: POST_EVENT_STATUSES.includes(source.status) ? source.status : 'scheduled',
  }
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const timeZoneOffsetMinutes = (date, timeZone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map(part => [part.type, part.value]))
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return (asIfUtc - date.getTime()) / 60000
}
// posts.vue localDateTimeInTimeZoneToUtcIso: "2026-11-02T18:30" in a time
// zone as an ISO UTC string; '' when either is missing or invalid.
export const localDateTimeToUtcIso = (value, timeZone) => {
  const match = LOCAL_DATE_TIME.exec(String(value || '').trim())
  if (!match || !timeZone)
    return ''
  try {
    const [, year, month, day, hour, minute, second] = match.map(Number)
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0)
    let utc = localAsUtc
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = localAsUtc - timeZoneOffsetMinutes(new Date(utc), timeZone) * 60000
      if (candidate === utc)
        break
      utc = candidate
    }
    return new Date(utc).toISOString()
  }
  catch {
    return ''
  }
}
export const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || !timeZone)
    return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return true
  }
  catch {
    return false
  }
}

// The event a save stores: ensurePostTypeAndEventDefaults also turns the
// capacity into a number, so a post without one saves 0.
export const savedPostEvent = (event = {}, defaultTimezone = 'UTC') => {
  const normalized = normalizePostEvent(event, defaultTimezone)
  const capacity = Number(normalized.capacity)
  return { ...normalized, capacity: Number.isFinite(capacity) ? capacity : null }
}

// syncEventUtcFields for an event: the UTC times from the local times and
// the time zone, and whether it has ended.
export const computePostEvent = (event, now = Date.now()) => {
  const startAtUtc = localDateTimeToUtcIso(event.startAt, event.timezone)
  const endAtUtc = localDateTimeToUtcIso(event.endAt, event.timezone)
  const endMs = endAtUtc ? Date.parse(endAtUtc) : Number.NaN
  return { ...event, startAtUtc, endAtUtc, isPast: Number.isFinite(endMs) ? endMs <= now : false }
}

// The event fields an operation gives, checked; and the post editor's rules
// for an event post (start, end and, in person, a location). An event also
// needs its time zone, unless the post already has one (`timezoneKnown`):
// the editor falls back to the browser's, an operation has none.
export const postEventProblems = (input, { type, merged, timezoneKnown = false } = {}) => {
  const problems = []
  if (input !== undefined) {
    if (!isPlainObject(input))
      return ['event must be an object of event fields.']
    for (const [key, value] of Object.entries(input)) {
      if (!POST_EVENT_FIELDS.includes(key))
        problems.push(`event.${key} can't be set (allowed: ${POST_EVENT_FIELDS.join(', ')}; startAtUtc, endAtUtc and isPast are computed).`)
      else if (EVENT_BOOLEAN_FIELDS.includes(key) && typeof value !== 'boolean')
        problems.push(`event.${key} must be true or false.`)
      else if (key === 'capacity' && value !== null && !(typeof value === 'number' && Number.isFinite(value)))
        problems.push('event.capacity must be a number or null.')
      else if (EVENT_STRING_FIELDS.includes(key) && typeof value !== 'string')
        problems.push(`event.${key} must be a string.`)
    }
    if (typeof input.status === 'string' && !POST_EVENT_STATUSES.includes(input.status))
      problems.push(`event.status must be one of: ${POST_EVENT_STATUSES.join(', ')}.`)
    for (const key of ['startAt', 'endAt']) {
      if (typeof input[key] === 'string' && input[key].trim() && !LOCAL_DATE_TIME.test(input[key].trim()))
        problems.push(`event.${key} must be a local date and time like "2026-11-02T18:30".`)
    }
    if (typeof input.timezone === 'string' && input.timezone && !isValidTimeZone(input.timezone))
      problems.push(`event.timezone "${input.timezone}" is not a time zone (use an IANA name like "America/Denver").`)
  }
  if (type === 'event' && merged) {
    if (!timezoneKnown && !(isPlainObject(input) && typeof input.timezone === 'string' && input.timezone))
      problems.push('An event needs event.timezone (an IANA name like "America/Denver"); its times are local to it.')
    if (!merged.startAt.trim())
      problems.push('Start At is required for events (event.startAt).')
    if (!merged.endAt.trim())
      problems.push('End At is required for events (event.endAt).')
    if (!merged.isVirtual && !merged.locationName.trim())
      problems.push('Location Name is required for in-person events (event.locationName).')
    if (!merged.isVirtual && !merged.locationAddress.trim())
      problems.push('Location Address is required for in-person events (event.locationAddress).')
  }
  return problems
}

// Custom event entries retain their custom type index; event data is orthogonal.
export const buildPostEvent = (input = {}) => {
  const event = normalizePostEvent(input)
  const writable = Object.fromEntries(POST_EVENT_FIELDS.filter(key => input[key] !== undefined).map(key => [key, input[key]]))
  const problems = postEventProblems(writable, { type: 'event', merged: event, timezoneKnown: false })
  if (!isValidTimeZone(event.timezone))
    problems.push('Choose a valid event timezone.')
  const computed = computePostEvent(event)
  if (!computed.startAtUtc || !computed.endAtUtc)
    problems.push('Choose valid event start and end dates.')
  if (computed.startAtUtc && computed.endAtUtc && computed.endAtUtc <= computed.startAtUtc)
    problems.push('Event End At must be after Start At.')
  if (problems.length)
    throw new Error(problems.join(' '))
  return Object.fromEntries([...POST_EVENT_FIELDS, 'startAtUtc', 'endAtUtc', 'isPast'].map(key => [key, computed[key]]))
}
export const postEventPublishProblem = (post, publishAtMs = Date.now()) => {
  if (post?.type !== 'event' && !(post?.postTypeId && post?.event))
    return ''
  if (post.event?.unpublishPastEvent !== false && Date.parse(post.event?.endAtUtc || '') <= publishAtMs)
    return 'Event End At is before the publication date while Unpublish Past Event is enabled.'
  return ''
}
