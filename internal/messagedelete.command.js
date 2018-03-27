const Command = require('./command');

const alias = [
  'delete-message',
  'deletemessage',
];

class DeleteMessage extends Command {
  runCommand({ discord, message }) {
    if (!message.data) throw new Error('Message ID not provided');
    const channel = message.channel;
    const messageID = message.data.id || message.data;
    const reason = message.data.reason || null;
    return discord.deleteMessage(channel, messageID, reason)
      .then(() => 'Success')
      .catch(error => ({ error: getError(error, messageID) }));
  }
}

// TODO: move this to a dedicated file
function getError(error, messageID) {
  switch (error.code || 0) {
    case 50001: // Missing Access
    case 50003: // Cannot execute action on a DM channel
    case 50005: // Another user
    case 50013: // Missing permissions
      return 'Access Denied';
    case 50035: return `Invalid Message ID: ${messageID}`;
    default: return error.message || error;
  }
}

module.exports = new DeleteMessage({ alias });
