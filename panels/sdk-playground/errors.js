// Every error code the bridge can answer with (contract section 4), and what
// each one asks of the panel that got it.

export const ERROR_MEANINGS = {
  not_ready: 'The call left before Deska answered ready. Await deska.ready() first; the SDK queues calls for you.',
  unknown_method: 'This Deska does not know the method. It may be newer than the app running the panel.',
  permission_denied: 'panel.json does not declare the permission this call needs, or the package has no Extras.',
  invalid_args: 'An argument has the wrong type or shape, like a number where text belongs or a URL that is not https.',
  rate_limited: 'Too many calls too fast: notify once per 10 s, openUrl once a second, 20 bridge calls a second.',
  too_large: 'The arguments pass 64 KB once serialized, or the clipboard text passes 64 KB.',
  storage_full: 'This package already keeps 256 KB in storage. Remove keys before writing more.',
  not_focused: 'Needs the person inside the panel. Call it from a click or a key press, not a timer.',
  declined: 'The person said no when Deska asked, or another question from Deska was already open.',
  host_error: "Something failed on Deska's side. Show it and let the person try again.",
}

/** The SDK rejects with an Error whose code (and message) is the bridge code. */
export function codeOf(err) {
  const code = err?.code ?? err?.message
  return code in ERROR_MEANINGS ? code : 'host_error'
}
