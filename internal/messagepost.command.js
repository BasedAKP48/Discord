const Command = require('./command');
const { content, discordError } = require('./messages');

const alias = [
  'post-message',
  'postmessage',
];

class PostMessage extends Command {
  runCommand({ discord, message }) {
    const channel = message.channel;
    if (!channel) throw new Error('Channel not provided');
    const body = content(message.data);
    return discord.createMessage(channel, body)
      .then(created => ({
        id: created.id,
        channel: (created.channel && created.channel.id) || channel,
      }))
      .catch(error => ({ error: discordError(error) }));
  }
}

module.exports = new PostMessage({ alias });
