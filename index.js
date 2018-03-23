const Eris = require('eris');
const Promise = require('bluebird');
const inquirer = require('inquirer');
const utils = require('@basedakp48/plugin-utils');
const getInternalCommand = require('./internal');

const connector = new utils.Connector({
  name: 'Discord',
  dir: __dirname,
});

let status = 'online';
let game = {};
let token;
let name;
let discord;

connector.on('config', (config, ref) => {
  if (!config || !config.token) {
    return prompt(ref);
  }

  if (discord && config.token !== token) {
    // we need to disconnect the bot and connect with our new token.
    console.log('reconnecting with new token');
    disconnect();
    discord = null;
  }

  if (config.name !== name) {
    name = config.name;
    // TODO: presenceSystem.setName(name);
  }

  if (config.game) {
    game = config.game;
    discord && discord.editStatus(game);
  }

  token = config.token;

  initializeBot();
})
  .on('destroy', disconnect);

connector.presenceSystem().on('status', (statuscode) => {
  status = statuscode;
  if (statuscode === 'afk') { // support "afk"
    status = 'idle';
  }
  discord && discord.editStatus(status);
});

connector.messageSystem().on('message/text', (msg, ref) => {
  if (!discord) return ref.remove(); // can't do anything without a bot.
  return discord.sendChannelTyping(msg.channel)
    .then(() => Promise.delay(750).then(() => {
      const content = {
        content: msg.text,
      };
      if (msg.data) {
        if (msg.data.mention && msg.data.mentionID) {
          content.content = `<@${msg.data.mentionID}> ${content.content}`;
        }
        if (msg.data.discord_embed) {
          content.embed = msg.data.discord_embed;
          if (!msg.data.includeText) {
            delete content.content;
          }
        }
      }
      return discord.createMessage(msg.channel, content);
    })).then(() => ref.remove());
}).on('message/internal', (msg, ref) => {
  if (discord) {
    getInternalCommand(msg)
      .then(c => c.getMessage({ connector, discord, message: msg }))
      .catch(e => ({ error: e.message }))
      .then((data) => {
        const message = {
          data,
          uid: connector.cid,
          target: msg.uid,
          channel: msg.channel,
          text: msg.text,
          type: 'AKPacket',
          timeReceived: Date.now(),
        };
        return connector.messageSystem().sendMessage(message);
      });
  }
  ref.remove();
});

function initializeBot(options) {
  if (discord || !token) return;
  discord = new Eris(token, {
    // options will go here later.
  });

  discord.on('error', msg => console.log('Error: ', msg));

  discord.on('ready', () => {
    console.log('connected to Discord');
    discord.editStatus(status, game);
  });

  discord.on('messageCreate', handleMessage)
    .on('guildMemberRemove', handleLeave)
    .on('guildMemberAdd', handleJoin);

  discord.connect();
}

function handleMessage(msg) {
  if (msg.author.id === discord.user.id) {
    return;
  }

  const channelName = (msg.channel.guild && msg.channel.name) || 'DirectMessage';
  const serverName = (msg.channel.guild && msg.channel.guild.name) || 'DirectMessage';

  const data = {
    channel: `#${channelName}`,
    source: `${msg.author.username}#${msg.author.discriminator}`,
    sourceIsBot: msg.author.bot,
    nick: (msg.channel.guild && msg.member.nick) || msg.author.username,
    serverID: msg.channel.guild ? msg.channel.guild.id : null,
    server: serverName,
    connectorType: 'discord',
    connectorName: name || null,
    connectorBotName: `${discord.user.username}#${discord.user.discriminator}`,
    isPM: msg.channel instanceof Eris.PrivateChannel || null,
    messageID: msg.id,
  };

  const BasedAKP48Msg = {
    data,
    cid: connector.cid,
    uid: msg.author.id,
    text: msg.content,
    channel: msg.channel.id,
    type: 'text',
    timeReceived: msg.timestamp,
  };

  connector.messageSystem().sendMessage(BasedAKP48Msg);
}

function handleJoin(guild, member) {
  handleJoinLeave(guild, member, 'join');
}


function handleLeave(guild, member) {
  handleJoinLeave(guild, member, 'leave');
}

function handleJoinLeave(guild, member, type) {
  const botName = `${discord.user.username}#${discord.user.discriminator}`;
  const message = {
    type,
    cid: connector.cid,
    uid: member.id,
    text: member.username || '',
    channel: guild.id,
    timeReceived: member.joinedAt,
    data: {
      connectorType: 'discord',
      server: guild.name,
      source: `${member.username}#${member.discriminator}`,
      sourceIsBot: member.bot,
      connectorName: name || null,
      connectorBotName: botName,
    },
  };
  connector.messageSystem().sendMessage(message);
}

function prompt(ref) {
  inquirer.prompt([{ name: 'token', message: "Enter your bot's Discord token:" }]).then((vals) => {
    if (vals.token) {
      ref.update({ token: vals.token });
    }
  });
}

function disconnect() {
  if (!discord) return;
  discord.editStatus('invisible');
  discord.disconnect({ reconnect: false });
  console.log('disconnected from Discord');
}
