const Command = require('./command');
const { content, discordError } = require('./messages');

const alias = [
  'edit-message',
  'editmessage',
];

class EditMessage extends Command {
  runCommand({ discord, message }) {
    const channel = message.channel;
    if (!channel) throw new Error('Channel not provided');
    const id = message.data && message.data.id;
    if (!id) throw new Error('Message ID not provided');
    const body = content(message.data, { edit: true });
    return discord.editMessage(channel, id, body)
      .then(edited => ({ id: edited.id }))
      .catch(error => ({ error: discordError(error) }));
  }
}

module.exports = new EditMessage({ alias });
