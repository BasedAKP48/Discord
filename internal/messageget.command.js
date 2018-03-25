const Eris = require('eris');
const Command = require('./command');

const alias = [
  'get-message',
  'message',
];

class GetMessage extends Command {
  runCommand({ discord, message }) {
    if (!message.data || typeof message.data !== 'string') throw new Error('Message ID not provided');
    const msgid = message.data;
    const guild = discord.guilds.get(discord.channelGuildMap[message.channel]);
    if (!guild) throw new Error('Server not found.');
    const channel = guild.channels.get(message.channel);
    if (!channel) throw new Error('Channel not found.');
    if (!(channel instanceof Eris.TextChannel)) throw new Error('Channel is not a text channel');
    if (channel.messages.has(msgid)) {
      return getMessageData(channel.messages.get(msgid));
    }
    return channel.getMessage(msgid)
      .then(msg => getMessageData(msg));
  }
}

function getMessageData(message) {
  const name = message.author.username;
  const nick = message.member && message.member.nick;
  const data = {
    content: message.content,
    cleanContent: message.cleanContent,
    type: message.type,
    created: message.timestamp,
    edited: message.editedTimestamp || null,
    reactions: message.reactions,
    pinned: message.pinned,
    attachments: message.attachments,
    embeds: message.embeds,
    server: {
      id: message.channel.guild.id,
      name: message.channel.guild.name,
    },
    channel: {
      id: message.channel.id,
      name: message.channel.name,
      parent: message.channel.parentID || null,
      nsfw: message.channel.nsfw || null,
    },
    user: {
      name,
      displayName: nick || name,
      discriminator: message.author.discriminator,
      avatar: message.author.staticAvatarURL,
      mention: message.author.mention,
    },
  };
  return data;
}

module.exports = new GetMessage({ alias });
