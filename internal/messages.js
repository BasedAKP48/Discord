const MAX_TEXT = 2000;
const NO_MENTIONS = { everyone: false, roles: false, users: false };

function discordError(error) {
  switch (error.code || 0) {
    case 10003: return 'Unknown channel';
    case 10008: return 'Unknown message';
    case 50001: // Missing Access
    case 50003: // Cannot execute action on a DM channel
    case 50005: // Another user
    case 50013: // Missing permissions
      return 'Access Denied';
    case 50035: return 'Invalid message';
    default: return error.message || String(error);
  }
}

function content(data, { edit = false } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Message data not provided');
  const { text, embed } = data;
  const hasText = typeof text === 'string' && text.length > 0;
  const hasEmbed = embed !== undefined && embed !== null;
  if (!hasText && !hasEmbed) throw new Error('Message text or embed not provided');
  if (hasText && text.length > MAX_TEXT) throw new Error(`Message text is over ${MAX_TEXT} characters`);
  if (hasEmbed && typeof embed !== 'object') throw new Error('Message embed must be an object');

  const body = { allowedMentions: NO_MENTIONS };
  if (hasText || edit) body.content = hasText ? text : '';
  if (hasEmbed) body.embeds = [embed];
  else if (edit) body.embeds = [];
  return body;
}

module.exports = {
  MAX_TEXT, NO_MENTIONS, content, discordError,
};
