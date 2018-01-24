const Command = require('./command');

const alias = [
  'user',
  'user-info',
  'user-data',
];

class UserLookup extends Command {
  runCommand({ discord, message }) {
    const userID = message.channel;

    const user = discord.users.get(userID);
    if (!user) throw new Error('User not found');

    const data = {
      name: user.username,
      hash: user.discriminator,
      avatar: user.staticAvatarUrl,
      mention: user.mention,
      bot: user.bot,
    };

    return data;
  }
}

module.exports = new UserLookup({ alias });
