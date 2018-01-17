const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');
const Eris = require('eris');
const Promise = require('bluebird');
const inquirer = require('inquirer');
const utils = require('@basedakp48/plugin-utils');
const pkg = require('./package.json');

const presenceSystem = utils.PresenceSystem();

utils.initialize(admin, serviceAccount);
const rootRef = admin.database().ref();
const cid = utils.getCID(rootRef, __dirname);

let status = 'online';
let game = {};
let token;
let name;
let bot;

presenceSystem.on('status', (statuscode) => {
  status = statuscode;
  if (statuscode === 'afk') { // support "afk"
    status = 'idle';
  }
  bot && bot.editStatus(status);
});

presenceSystem.initialize({
  rootRef,
  cid,
  pkg,
  instanceName: name || null,
  listenMode: 'connector',
});

rootRef.child(`config/clients/${cid}`).on('value', (d) => {
  const config = d.val();

  if (!config || !d.hasChild('token')) {
    prompt(d.ref);
    return;
  }

  if (bot && config.token !== token) {
    // we need to disconnect the bot and connect with our new token.
    console.log('Reconnecting with new token');
    disconnect();
    bot = null;
  }

  if (config.name !== name) {
    name = config.name;
    // TODO: presenceSystem.setName(name);
  }

  if (config.game) {
    ({ game } = config.game);
    bot && bot.editStatus(game);
  }

  token = config.token;

  initializeBot();
});

rootRef.child(`clients/${cid}`).on('child_added', (d) => {
  if (!bot) return d.ref.remove(); // can't do anything without a bot.

  const msg = d.val();
  if (msg.type.toLowerCase() === 'text') {
    return bot.sendChannelTyping(msg.channel).then(() => Promise.delay(750).then(() => {
      if (msg.data && msg.data.discord_embed) {
        return bot.createMessage(msg.channel, { embed: msg.data.discord_embed });
      }
      if (msg.data && msg.data.mention) {
        return bot.createMessage(msg.channel, `<@${msg.data.mentionID}> ${msg.text}`);
      }
      return bot.createMessage(msg.channel, msg.text);
    })).then(() => d.ref.remove());
  }
});

function initializeBot(options) {
  if (bot || !token) return;
  bot = new Eris(token, {
    // options will go here later.
  });

  bot.on('error', msg => console.log('Error: ', msg));

  bot.on('ready', () => {
    console.log('connected to Discord');
    bot.editStatus(status, game);
  });

  bot.on('messageCreate', handleMessage);

  bot.connect();
}

function handleMessage(msg) {
  if (msg.author.id === bot.user.id) {
    return;
  }

  const channelName = (msg.channel.guild && msg.channel.name) || 'DirectMessage';
  const serverName = (msg.channel.guild && msg.channel.guild.name) || 'DirectMessage';

  const data = {
    channel: `#${channelName}`,
    source: `${msg.author.username}#${msg.author.discriminator}`,
    nick: (msg.channel.guild && msg.member.nick) || msg.author.username,
    server: serverName,
    connectorType: 'discord',
    connectorName: name || null,
    connectorBotName: `${bot.user.username}#${bot.user.discriminator}`,
    isPM: msg.channel instanceof Eris.PrivateChannel || null,
  };

  const BasedAKP48Msg = {
    cid,
    data,
    uid: msg.author.id,
    text: msg.content,
    channel: msg.channel.id,
    type: 'text',
    timeReceived: msg.timestamp,
  };

  rootRef.child('pendingMessages').push(BasedAKP48Msg);
}

function prompt(ref) {
  inquirer.prompt([{ name: 'token', message: "Enter your bot's discord token:" }]).then((vals) => {
    if (vals.token) {
      ref.update({ token: vals.token });
    }
  });
}

process.on('SIGINT', () => {
  console.log('Caught interrupt signal, disconnecting from Discord');
  disconnect();
  process.exit();
});

function disconnect() {
  if (!bot) return;
  bot.editStatus('invisible');
  bot.disconnect({ reconnect: false });
}
