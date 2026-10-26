const Eris = require('eris');
const readline = require('readline');
const { promisify } = require('util');
const utils = require('@basedakp48/plugin-utils');
const getInternalCommand = require('./internal');
const {
  buildInteractionMessage,
  createInteractionHandler,
  createRelay,
} = require('./src/interactions');
const { GLOBAL, planSync, reconcile } = require('./src/slash');

const connector = new utils.Connector({
  name: 'Discord',
  dir: __dirname,
});

const delay = promisify(setTimeout);

const PREFIX = '.';
const SYNC_DELAY = 5000;
const SYNC_REFRESH = 10 * 60 * 1000;

let status = 'online';
let game = {};
let token;
let name;
let discord;
let slashEnabled = false;
let commandGuild;
let syncTimer;

const commands = new Map();
const synced = new Map();
const reported = new Set();
const relay = createRelay({ onError });
const handleInteraction = createInteractionHandler({
  relay,
  prefix: PREFIX,
  isAllowed: utils.allowedHere,
  getCommands: () => commands,
  buildMessage: (interaction, text) => buildInteractionMessage(interaction, text, {
    cid: connector.cid,
    connectorName: name,
    botName: `${discord.user.username}#${discord.user.discriminator}`,
  }),
  send: message => connector.messageSystem().sendMessage(message),
});

connector.on('config', (config, ref) => {
  if (!config || !config.token) {
    return prompt(ref);
  }

  if (discord && config.token !== token) {
    // we need to disconnect the bot and connect with our new token.
    console.log('reconnecting with new token');
    disconnect();
    discord = null;
    synced.clear();
  }

  slashEnabled = config.slashCommands === true;
  commandGuild = config.commandGuild || undefined;
  scheduleSync();

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

connector.messageSystem().on('message/text', (msg, ref) =>
  answerInteraction(msg)
    .then(answered => answered || sendMessage(msg))
    .catch(onError)
    .then(() => ref.remove()));
connector.messageSystem().on('message/internal', (msg, ref) => {
  ref.remove();
  if (!discord) return;
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
    })
    .catch(onError);
}).on('message/private', (msg, ref) => {
  ref.remove();
  if (!discord) return;
  answerInteraction(msg, { private: true })
    .then(answered => answered || discord.getDMChannel(msg.channel).then((channel) => {
      msg.channel = channel.id;
      return sendMessage(msg);
    }))
    .catch(onError);
});

connector.root.child('registry').on('value', scheduleSync);
setInterval(scheduleSync, SYNC_REFRESH).unref();

function initializeBot(options) {
  if (discord || !token) return;
  discord = new Eris(token, {
    intents: ['guilds', 'guildMembers', 'guildMessages', 'directMessages', 'messageContent'],
  });

  discord.on('error', msg => console.log('Error: ', msg));

  discord.on('ready', () => {
    console.log('connected to Discord');
    discord.editStatus(status, game);
    scheduleSync();
  });

  discord.on('interactionCreate', interaction => handleInteraction(interaction).catch(onError));

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
    nick: (msg.member && msg.member.nick) || msg.author.username,
    serverID: msg.channel.guild ? msg.channel.guild.id : null,
    parentID: msg.channel.parentID || null,
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

async function prompt(ref) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(res => rl.question("Enter your bot's Discord token: ", res));
  rl.close();
  if (answer) {
    ref.update({ token: answer });
  }
}

function disconnect() {
  if (!discord) return;
  discord.editStatus('invisible');
  discord.disconnect({ reconnect: false });
  console.log('disconnected from Discord');
}

function messageContent(msg) {
  const content = {
    content: msg.text,
  };
  if (msg.data) {
    if (msg.data.mentionID) {
      content.content = `<@!${msg.data.mentionID}> ${content.content}`;
    }
    if (msg.data.discord_embed) {
      content.embeds = [msg.data.discord_embed];
      if (!msg.data.includeText) {
        delete content.content;
      }
    }
  }
  return content;
}

function sendMessage(msg) {
  if (!discord) return Promise.resolve();
  return discord.sendChannelTyping(msg.channel)
    .then(() => delay(750).then(() => discord.createMessage(msg.channel, messageContent(msg))));
}

async function answerInteraction(msg, options) {
  const id = msg.data && msg.data.interactionId;
  if (!id || !relay.has(id)) return false;
  return relay.reply(id, messageContent(msg), options);
}

function scheduleSync() {
  if (!slashEnabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncCommands().catch(onError), SYNC_DELAY);
}

function reportOnce(text) {
  if (reported.has(text)) return;
  reported.add(text);
  console.log(text);
}

async function syncCommands() {
  if (!slashEnabled || !discord || !discord.application) return;

  const found = await utils.collectCommands(connector.root);
  commands.clear();
  found.commands.forEach(command => commands.set(command.name, command));
  found.conflicts.forEach(({ name: conflict, cid, winner }) => {
    reportOnce(`command ${conflict} from ${cid} is ignored, ${winner} already offers it`);
  });
  found.invalid.forEach(({ name: invalid, cid, problems }) => {
    reportOnce(`command ${invalid} from ${cid} is invalid: ${problems.join('; ')}`);
  });

  const plan = planSync(found.commands, { commandGuild, guildsOf: utils.commandGuilds });
  const { updates, clears } = reconcile(plan, synced);

  const attempt = (target, task) => task().catch((error) => {
    reportOnce(`could not update the slash commands of ${target}: ${error.message}`);
  });
  const sequence = (items, task) => items
    .reduce((chain, item) => chain.then(() => task(item)), Promise.resolve());

  await sequence(updates, ({ target, payload, hash }) => attempt(target, async () => {
    const body = JSON.parse(JSON.stringify(payload));
    await (target === GLOBAL
      ? discord.bulkEditCommands(body)
      : discord.bulkEditGuildCommands(target, body));
    synced.set(target, hash);
    console.log(`registered ${payload.length} slash commands (${target})`);
  }));
  await sequence(clears, id => attempt(id, async () => {
    await discord.bulkEditGuildCommands(id, []);
    synced.delete(id);
    console.log(`removed the slash commands of ${id}`);
  }));
}

function onError(error) {
  if (!connector.sendError(error)) {
    console.error(error);
  }
}
